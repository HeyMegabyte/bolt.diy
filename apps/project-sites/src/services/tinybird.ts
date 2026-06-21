/**
 * Tinybird ingest adapter — high-cardinality per-tenant analytics (OLAP).
 *
 * @remarks
 * Tinybird (managed ClickHouse) is the analytics OLAP store per `INFRA_NOTES.md`
 * (D1 stays edge-hot OLTP; Neon is the relational escape hatch). This adapter
 * resolves the Events-API config from env and fire-and-forget-ingests NDJSON
 * events. Env-gated: `resolveTinybird` returns `null` when unconfigured so every
 * caller is a safe no-op until `TINYBIRD_API_HOST` + a token are present — zero
 * behavior change. NEVER throws (analytics must never break a request path); the
 * caller wraps the send in `ctx.waitUntil` so it stays off the hot path.
 *
 * Events API: `POST {apiHost}/v0/events?name={datasource}` with
 * `Authorization: Bearer {token}` + an NDJSON body (one JSON object per line).
 * Multi-tenant: every event is tagged `{ site_id, tenant_id }` so a single
 * datasource serves all sites with row-level tenant attribution.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';

/** Resolved Tinybird Events-API config. */
export interface TinybirdConfig {
  /** API host WITHOUT a trailing slash, e.g. `https://api.us-east.aws.tinybird.co`. */
  apiHost: string;
  /** Workspace token (append/admin) used as the Bearer credential. */
  token: string;
}

/** A tenant-tagged analytics event. `timestamp` is auto-stamped if absent. */
export interface TinybirdEvent {
  site_id: string;
  tenant_id?: string;
  event: string;
  timestamp?: string;
  [key: string]: unknown;
}

function trimUrl(u: string): string {
  return u.trim().replace(/\/+$/, '');
}

function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolve the Tinybird Events-API config, or `null` when unconfigured/invalid.
 * Token precedence: `TINYBIRD_TOKEN` → `TINYBIRD_PASSWORD` (a workspace token)
 * → `TINYBIRD_MCP_TOKEN`. Pure + total — never throws.
 *
 * @param env - Worker env (reads `TINYBIRD_API_HOST` + the token chain).
 * @returns A {@link TinybirdConfig}, or `null` to signal "analytics disabled".
 * @example
 * const tb = resolveTinybird(env);
 * if (tb) ctx.waitUntil(ingestTinybirdEvent(env, 'site_events', { site_id, event: 'page_view' }));
 */
export function resolveTinybird(env: Env): TinybirdConfig | null {
  const host = (env as { TINYBIRD_API_HOST?: string }).TINYBIRD_API_HOST;
  if (!host || !isHttpUrl(host)) return null;
  const e = env as {
    TINYBIRD_TOKEN?: string;
    TINYBIRD_PASSWORD?: string;
    TINYBIRD_MCP_TOKEN?: string;
  };
  const token = (e.TINYBIRD_TOKEN || e.TINYBIRD_PASSWORD || e.TINYBIRD_MCP_TOKEN || '').trim();
  if (!token) return null;
  return { apiHost: trimUrl(host), token };
}

/**
 * Resolve config for the INGEST (append) path. Identical to {@link resolveTinybird}
 * except the token precedence prefers an APPEND-capable token: a dedicated
 * `TINYBIRD_INGEST_TOKEN`, else the admin `TINYBIRD_MCP_TOKEN`, before the
 * read-only `TINYBIRD_PASSWORD`. The Events API rejects a read-only token with
 * 403 "Invalid token" (verified 2026-06-20: TINYBIRD_PASSWORD has PIPES:READ but
 * not DATASOURCES:APPEND), which silently dead-letters the outbox drain. Reads
 * (`resolveTinybird`) stay least-privilege; only ingest reaches for append.
 *
 * @param env - Worker env (Tinybird host + token chain).
 * @returns A {@link TinybirdConfig} with an append-capable token, or `null`.
 */
export function resolveTinybirdAppend(env: Env): TinybirdConfig | null {
  const host = (env as { TINYBIRD_API_HOST?: string }).TINYBIRD_API_HOST;
  if (!host || !isHttpUrl(host)) return null;
  const e = env as {
    TINYBIRD_INGEST_TOKEN?: string;
    TINYBIRD_TOKEN?: string;
    TINYBIRD_MCP_TOKEN?: string;
    TINYBIRD_PASSWORD?: string;
  };
  const token = (
    e.TINYBIRD_INGEST_TOKEN ||
    e.TINYBIRD_TOKEN ||
    e.TINYBIRD_MCP_TOKEN ||
    e.TINYBIRD_PASSWORD ||
    ''
  ).trim();
  if (!token) return null;
  return { apiHost: trimUrl(host), token };
}

/** Outcome of an ingest attempt. */
export interface TinybirdIngestResult {
  /** True when Tinybird accepted the rows (HTTP 2xx). */
  ok: boolean;
  /** Why it didn't send/accept — for structured logging, never thrown. */
  reason?: 'not_configured' | 'no_events' | 'http_error' | 'network_error';
  /** HTTP status when a request was made. */
  status?: number;
}

/**
 * Fire-and-forget ingest of one or more tenant-tagged events into a Tinybird
 * datasource via the Events API. Never throws — returns a typed result.
 * Auto-stamps `timestamp` (ISO) on any event missing it. Designed to be wrapped
 * in `ctx.waitUntil` so it stays off the request hot path.
 *
 * @param env - Worker env.
 * @param datasource - Target Tinybird datasource name (`?name=`).
 * @param events - One event or an array (sent as NDJSON).
 * @param deps - Optional `{ fetchImpl, now }` for tests.
 * @returns A {@link TinybirdIngestResult} (`not_configured` when env-gated off).
 */
export async function ingestTinybirdEvent(
  env: Env,
  datasource: string,
  events: TinybirdEvent | TinybirdEvent[],
  deps: { fetchImpl?: typeof fetch; now?: () => string } = {},
): Promise<TinybirdIngestResult> {
  // Ingest needs DATASOURCES:APPEND — the read-only TINYBIRD_PASSWORD 403s here.
  const cfg = resolveTinybirdAppend(env);
  if (!cfg) return { ok: false, reason: 'not_configured' };

  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return { ok: false, reason: 'no_events' };

  const stamp = deps.now ?? (() => new Date().toISOString());
  const ndjson = list
    .map((ev) => JSON.stringify(ev.timestamp ? ev : { ...ev, timestamp: stamp() }))
    .join('\n');

  const url = `${cfg.apiHost}/v0/events?name=${encodeURIComponent(datasource)}`;
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
    });
    if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };
    return { ok: true, status: res.status };
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

/** Outcome of a pipe read. `data` is always an array (empty on any failure). */
export interface TinybirdQueryResult<T> {
  /** True when Tinybird returned a 2xx body with a `data` array. */
  ok: boolean;
  /** Why it didn't return data — for structured logging, never thrown. */
  reason?: 'not_configured' | 'http_error' | 'network_error' | 'parse_error';
  /** HTTP status when a request was made. */
  status?: number;
  /** The pipe's rows (empty `[]` on any non-ok outcome). */
  data: T[];
}

/**
 * Read a Tinybird Pipe's JSON endpoint (`GET /v0/pipes/{pipe}.json`). The read
 * counterpart to {@link ingestTinybirdEvent} — same resolve→fetch→typed-result
 * shape, never throws. Undefined/empty params are dropped. Returns
 * `{ ok:false, reason:'not_configured', data:[] }` when analytics is env-gated
 * off, so callers can fall back gracefully (e.g. render a zero-state).
 *
 * @param env - Worker env (reads the Tinybird config chain).
 * @param pipe - Pipe name (without the `.json` suffix).
 * @param params - Query params for the pipe (`tenant_id`, `days`, …).
 * @param deps - Optional `{ fetchImpl }` for tests.
 * @returns A {@link TinybirdQueryResult}.
 * @example
 * const r = await queryTinybirdPipe(env, 'activation_funnel', { tenant_id, days: 30 });
 * if (r.ok) renderFunnel(r.data);
 */
export async function queryTinybirdPipe<T = Record<string, unknown>>(
  env: Env,
  pipe: string,
  params: Record<string, string | number | undefined> = {},
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<TinybirdQueryResult<T>> {
  const cfg = resolveTinybird(env);
  if (!cfg) return { ok: false, reason: 'not_configured', data: [] };

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const query = qs.toString();
  const url = `${cfg.apiHost}/v0/pipes/${encodeURIComponent(pipe)}.json${query ? `?${query}` : ''}`;
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) return { ok: false, reason: 'http_error', status: res.status, data: [] };
    try {
      const body = (await res.json()) as { data?: unknown };
      return {
        ok: true,
        status: res.status,
        data: Array.isArray(body.data) ? (body.data as T[]) : [],
      };
    } catch {
      return { ok: false, reason: 'parse_error', status: res.status, data: [] };
    }
  } catch {
    return { ok: false, reason: 'network_error', data: [] };
  }
}
