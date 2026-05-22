/**
 * @module durable_objects/trace_hub
 * @description SQLite-backed Durable Objects for global trace + activity feeds.
 *
 * Migrates the legacy KV-style `ctx.storage.get/put` implementations to the
 * SQLite storage backend (GA April 2025, paid since Jan 7 2026). SQLite
 * unlocks server-side filtering, indexes, and standard SQL aggregates
 * without round-tripping every row through the Worker.
 *
 * ## Usage
 *
 * ```ts
 * // Resolve the singleton via the GA `getByName` API (no idFromName step).
 * const hub = env.TRACE_HUB!.getByName('global');
 * await hub.fetch('http://do/events', {
 *   method: 'POST',
 *   body: JSON.stringify({ service: 'route', level: 'info', message: 'hi' }),
 * });
 * ```
 *
 * Schema lives in `migrations/do-tracehub-schema.sql` (source of truth).
 * The DO embeds the same DDL inline + runs it on every first request via
 * idempotent `CREATE TABLE IF NOT EXISTS` so cold-start is self-healing.
 *
 * @packageDocumentation
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types/env.js';

/** Inline copy of `migrations/do-tracehub-schema.sql` (kept in lockstep). */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trace_events (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  request_id  TEXT,
  service     TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message     TEXT NOT NULL,
  payload     TEXT
);
CREATE INDEX IF NOT EXISTS trace_events_ts_idx ON trace_events(ts DESC);
CREATE INDEX IF NOT EXISTS trace_events_request_idx ON trace_events(request_id);

CREATE TABLE IF NOT EXISTS activity_events (
  id         TEXT PRIMARY KEY,
  ts         INTEGER NOT NULL,
  org_id     TEXT,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target_id  TEXT,
  metadata   TEXT
);
CREATE INDEX IF NOT EXISTS activity_events_ts_idx ON activity_events(ts DESC);
CREATE INDEX IF NOT EXISTS activity_events_org_idx ON activity_events(org_id, ts DESC);
`;

/** Wire-format for a posted trace event. */
export interface TraceEventInput {
  request_id?: string;
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  payload?: unknown;
}

/** Wire-format for a posted activity event. */
export interface ActivityEventInput {
  org_id?: string;
  actor_id?: string;
  action: string;
  target_id?: string;
  metadata?: unknown;
}

/** Row shape returned by `GET /events`. The index signature satisfies the
 * `Record<string, SqlStorageValue>` constraint that `ctx.storage.sql.exec()`
 * uses for typed row iteration — without it the cursor's `.toArray()` call
 * refuses to widen into the named interface. */
interface TraceRow {
  id: string;
  ts: number;
  request_id: string | null;
  service: string;
  level: string;
  message: string;
  payload: string | null;
  [key: string]: SqlStorageValue;
}

/** Row shape returned by `GET /activity`. Same index-signature rationale as
 * `TraceRow` — required for `ctx.storage.sql.exec<ActivityRow>(...)`. */
interface ActivityRow {
  id: string;
  ts: number;
  org_id: string | null;
  actor_id: string | null;
  action: string;
  target_id: string | null;
  metadata: string | null;
  [key: string]: SqlStorageValue;
}

/**
 * SQLite-backed Durable Object holding the global trace ring buffer.
 *
 * Use `env.TRACE_HUB.getByName('global')` to resolve the singleton.
 *
 * @example
 * ```ts
 * const stub = env.TRACE_HUB!.getByName('global');
 * await stub.fetch('http://do/events', {
 *   method: 'POST',
 *   body: JSON.stringify({ service: 'route', level: 'info', message: 'ok' }),
 * });
 * ```
 */
export class TraceHub extends DurableObject<Env> {
  /** Flag flipped true after `ensureSchema` has run for the lifetime of the DO. */
  private schemaReady = false;

  /**
   * Returns the SQL storage handle when the DO was created with SQLite backend,
   * else `null` (legacy classic-storage class deployed pre-migration). Callers
   * gracefully no-op when `null` so the worker keeps shipping until a future
   * `TraceHubV2` rename can adopt SQLite cleanly.
   */
  private get sql(): SqlStorage | null {
    const candidate = (this.ctx.storage as { sql?: SqlStorage }).sql;
    return candidate ?? null;
  }

  /**
   * Idempotently run the embedded schema DDL. Safe to call on every request
   * because `CREATE TABLE IF NOT EXISTS` is a no-op after the first call.
   *
   * @internal
   */
  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.sql?.exec(SCHEMA_SQL);
    this.schemaReady = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const sql = this.sql;
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/events') {
      const body = (await request.json()) as TraceEventInput;
      if (!sql) return Response.json({ ok: true, mode: 'legacy-noop' });
      sql.exec(
        `INSERT INTO trace_events (id, ts, request_id, service, level, message, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        Date.now(),
        body.request_id ?? null,
        body.service,
        body.level,
        body.message,
        body.payload === undefined ? null : JSON.stringify(body.payload),
      );
      return Response.json({ ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/events') {
      if (!sql) return Response.json({ events: [] });
      const limit = Math.min(500, Number(url.searchParams.get('limit') ?? '100'));
      const rows = sql
        .exec<TraceRow>(
          `SELECT id, ts, request_id, service, level, message, payload
             FROM trace_events ORDER BY ts DESC LIMIT ?`,
          limit,
        )
        .toArray();
      return Response.json({ events: rows });
    }
    return new Response('not found', { status: 404 });
  }
}

/**
 * SQLite-backed Durable Object holding the global activity feed.
 *
 * Use `env.ACTIVITY_HUB.getByName('global')` to resolve the singleton.
 *
 * @example
 * ```ts
 * const stub = env.ACTIVITY_HUB!.getByName('global');
 * await stub.fetch('http://do/activity', {
 *   method: 'POST',
 *   body: JSON.stringify({ org_id: 'o1', action: 'site.published', target_id: 's1' }),
 * });
 * ```
 */
export class ActivityHub extends DurableObject<Env> {
  /** Flag flipped true after `ensureSchema` has run for the lifetime of the DO. */
  private schemaReady = false;

  /** SQL storage handle when available (SQLite-backed) else `null` (legacy class). */
  private get sql(): SqlStorage | null {
    const candidate = (this.ctx.storage as { sql?: SqlStorage }).sql;
    return candidate ?? null;
  }

  /** @internal */
  private ensureSchema(): void {
    if (this.schemaReady) return;
    this.sql?.exec(SCHEMA_SQL);
    this.schemaReady = true;
  }

  override async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const sql = this.sql;
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/activity') {
      const body = (await request.json()) as ActivityEventInput;
      if (!sql) return Response.json({ ok: true, mode: 'legacy-noop' });
      sql.exec(
        `INSERT INTO activity_events (id, ts, org_id, actor_id, action, target_id, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        Date.now(),
        body.org_id ?? null,
        body.actor_id ?? null,
        body.action,
        body.target_id ?? null,
        body.metadata === undefined ? null : JSON.stringify(body.metadata),
      );
      return Response.json({ ok: true });
    }
    if (request.method === 'GET' && url.pathname === '/activity') {
      if (!sql) return Response.json({ events: [] });
      const limit = Math.min(500, Number(url.searchParams.get('limit') ?? '100'));
      const orgId = url.searchParams.get('org_id');
      const rows = orgId
        ? sql
            .exec<ActivityRow>(
              `SELECT id, ts, org_id, actor_id, action, target_id, metadata
                 FROM activity_events WHERE org_id = ? ORDER BY ts DESC LIMIT ?`,
              orgId,
              limit,
            )
            .toArray()
        : sql
            .exec<ActivityRow>(
              `SELECT id, ts, org_id, actor_id, action, target_id, metadata
                 FROM activity_events ORDER BY ts DESC LIMIT ?`,
              limit,
            )
            .toArray();
      return Response.json({ events: rows });
    }
    return new Response('not found', { status: 404 });
  }
}
