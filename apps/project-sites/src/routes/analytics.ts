/**
 * @module routes/analytics
 *
 * Unified Analytics ingestion plane — Plane H.
 * Fast-ack `POST /api/events` dispatches validated events to the
 * `EventDispatcher` Durable Object via `ctx.waitUntil` so the HTTP
 * response is always immediate. The debug endpoint `GET /api/analytics-debug`
 * proxies to the DO for operator inspection.
 *
 * Both routes degrade gracefully when the `EVENT_DISPATCHER` binding is
 * absent (test / local dev environments without the DO configured).
 *
 * @example
 * // Mount in src/index.ts:
 * import { analyticsRoutes } from './routes/analytics.js';
 * app.route('/', analyticsRoutes);
 */

import { Hono } from 'hono';
import { IncomingEventSchema, type IncomingEvent } from '../services/analytics_events.js';
import { ensureAnalyticsSchema } from '../services/analytics_schema.js';
import type { Env } from '../types/env.js';

export const analyticsRoutes = new Hono<{ Bindings: Env }>();

/**
 * Persist a validated event to the `analytics_events` table (the durable local
 * copy the Analytics tab reads). Best-effort + never throws: `INSERT OR IGNORE`
 * dedups on the `eventId UNIQUE` index, and a missing table self-heals once via
 * {@link ensureAnalyticsSchema} then retries. Independent of the dispatcher DO,
 * so analytics are readable even before the DO binding goes live.
 *
 * @param db - The platform D1 database.
 * @param event - A schema-validated incoming event.
 */
export async function persistAnalyticsEvent(db: D1Database, event: IncomingEvent): Promise<void> {
  const insert = () =>
    db
      .prepare(
        `INSERT OR IGNORE INTO analytics_events
           (id, siteId, eventId, eventType, userId, sessionId, timestamp, payload, ip, dedupId, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ingested')`,
      )
      .bind(
        crypto.randomUUID(),
        event.siteId,
        event.eventId,
        event.eventType,
        event.userId ?? null,
        event.sessionId ?? null,
        event.timestamp,
        JSON.stringify(event.payload ?? {}),
        event.ip ?? null,
        event.eventId,
      )
      .run();
  try {
    await insert();
  } catch {
    try {
      await ensureAnalyticsSchema(db);
      await insert();
    } catch (err) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'analytics.persist_failed', siteId: event.siteId, error: String(err) }));
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/events — ingest a single analytics event
// ---------------------------------------------------------------------------

/**
 * Ingest an analytics event.
 *
 * Validates the body with `IncomingEventSchema`, then dispatches to the
 * `EventDispatcher` Durable Object inside `ctx.waitUntil` so the caller
 * always receives a fast 202 ack — never awaiting the DO round-trip.
 *
 * When `EVENT_DISPATCHER` is absent (test / local), the dispatch is skipped
 * and a 202 is still returned.
 *
 * @returns 202 `{status:'queued'}` on success, 400 `{error:'invalid_event', details}` on validation failure.
 *
 * @example
 * POST /api/events
 * {
 *   "eventId": "123e4567-e89b-42d3-a456-426614174000",
 *   "siteId": "s1",
 *   "eventType": "pageview",
 *   "timestamp": 1700000000000
 * }
 * → 202 { status: 'queued' }
 */
analyticsRoutes.post('/api/events', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_event', details: 'Request body must be valid JSON.' }, 400);
  }

  const parsed = IncomingEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: 'invalid_event', details: parsed.error.flatten() },
      400,
    );
  }

  const event: IncomingEvent = parsed.data;
  const env = c.env;

  // Durable local copy (the Analytics tab feed) — runs regardless of the DO.
  if (env.DB) {
    const dbWrite = persistAnalyticsEvent(env.DB, event);
    try {
      c.executionCtx.waitUntil(dbWrite);
    } catch {
      void dbWrite;
    }
  }

  if (env.EVENT_DISPATCHER) {
    const p = (async () => {
      try {
        const stub = env.EVENT_DISPATCHER!.get(env.EVENT_DISPATCHER!.idFromName(event.siteId));
        await stub.fetch(
          new Request('https://do/enqueue', {
            method: 'POST',
            body: JSON.stringify(event),
          }),
        );
      } catch (err) {
        console.warn(JSON.stringify({
          level: 'warn',
          msg: 'analytics.enqueue_failed',
          siteId: event.siteId,
          eventId: event.eventId,
          error: String(err),
        }));
      }
    })();

    // Guard: executionCtx getter throws in Hono's test harness
    try {
      c.executionCtx.waitUntil(p);
    } catch {
      void p;
    }
  }

  return c.json({ status: 'queued' }, 202);
});

// ---------------------------------------------------------------------------
// GET /api/analytics-debug — operator debug proxy to EventDispatcher DO
// ---------------------------------------------------------------------------

/**
 * Proxy operator debug request to the `EventDispatcher` Durable Object.
 *
 * Requires `siteId` query param. When `EVENT_DISPATCHER` binding is absent
 * returns a graceful fallback body rather than throwing.
 *
 * @param siteId - Required query param identifying which site's DO to query.
 * @returns 200 JSON from the DO's `/debug` endpoint, or fallback payload.
 *
 * @example
 * GET /api/analytics-debug?siteId=s1
 * → 200 { events: [], note: 'dispatcher_unavailable' }  // when binding absent
 */
analyticsRoutes.get('/api/analytics-debug', async (c) => {
  const siteId = c.req.query('siteId');
  if (!siteId) {
    return c.json({ error: 'missing_param', details: 'siteId query param is required.' }, 400);
  }

  const env = c.env;

  if (!env.EVENT_DISPATCHER) {
    return c.json({ events: [], note: 'dispatcher_unavailable' }, 200);
  }

  try {
    const stub = env.EVENT_DISPATCHER.get(env.EVENT_DISPATCHER.idFromName(siteId));
    const res = await stub.fetch(new Request('https://do/debug'));
    const data = await res.json();
    return c.json(data, 200);
  } catch (err) {
    console.warn(JSON.stringify({
      level: 'warn',
      msg: 'analytics.debug_failed',
      siteId,
      error: String(err),
    }));
    return c.json({ events: [], note: 'dispatcher_unavailable' }, 200);
  }
});

// ---------------------------------------------------------------------------
// GET /api/analytics-data — the Analytics tab feed (durable D1 store)
// ---------------------------------------------------------------------------

/**
 * Return the most recent stored events for a site — what the admin Analytics
 * tab renders. Reads the `analytics_events` D1 table directly (independent of
 * the dispatcher DO). Never throws: a missing table / DB yields an empty feed.
 *
 * @param siteId - Required query param.
 * @param limit - Optional, default 100, capped at 500.
 * @returns 200 `{ events: [...], count, has_more }` or `{ events: [], note }`.
 * @example GET /api/analytics-data?siteId=s1&limit=50
 */
analyticsRoutes.get('/api/analytics-data', async (c) => {
  const siteId = c.req.query('siteId');
  if (!siteId) {
    return c.json({ error: 'missing_param', details: 'siteId query param is required.' }, 400);
  }
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 100));
  const db = c.env.DB;
  if (!db) return c.json({ events: [], count: 0, has_more: false, note: 'db_unavailable' }, 200);

  try {
    const { results } = await db
      .prepare(
        `SELECT id, eventId, eventType, userId, sessionId, timestamp, payload, status
           FROM analytics_events WHERE siteId = ? ORDER BY timestamp DESC LIMIT ?`,
      )
      .bind(siteId, limit + 1)
      .all();
    const rows = (results ?? []) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const events = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
      ...r,
      payload: typeof r['payload'] === 'string' ? safeParse(r['payload'] as string) : r['payload'],
    }));
    return c.json({ events, count: events.length, has_more: hasMore }, 200);
  } catch (err) {
    console.warn(JSON.stringify({ level: 'warn', msg: 'analytics.data_failed', siteId, error: String(err) }));
    return c.json({ events: [], count: 0, has_more: false, note: 'no_data' }, 200);
  }
});

/** Parse a JSON string, returning `{}` on failure (never throws). */
function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
