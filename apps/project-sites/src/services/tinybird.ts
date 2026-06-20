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
  const cfg = resolveTinybird(env);
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
