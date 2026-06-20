/**
 * Hatchet dispatch adapter — durable task/workflow orchestration (cloud-hosted).
 *
 * @remarks
 * Hatchet is the orchestration backend behind the `event_bus` outbox (the
 * `'hatchet'` producer). This adapter resolves connection config FROM THE API
 * TOKEN itself — a Hatchet JWT embeds `server_url` (the shard host) + `sub` (the
 * tenant id), so a single `HATCHET_API_TOKEN` is self-describing; env vars only
 * OVERRIDE. Env-gated: `resolveHatchet` returns `null` with no token → every
 * caller is a safe no-op (the outbox just stays pending). NEVER throws — a
 * dispatch failure must not break the request path; the outbox retries.
 *
 * The event-push PATH is `HATCHET_EVENTS_PATH`-overridable (default the v1 REST
 * events route) so a Hatchet API-version change is a config flip, not a redeploy.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';

/** Resolved Hatchet connection config. */
export interface HatchetConfig {
  /** Shard server URL WITHOUT a trailing slash (from the JWT `server_url`). */
  serverUrl: string;
  /** Tenant id (from the JWT `sub`). */
  tenantId: string;
  /** The raw API token (Bearer). */
  token: string;
  /** REST path template for event push; `{tenant}` is substituted. */
  eventsPath: string;
}

const DEFAULT_EVENTS_PATH = '/api/v1/stable/tenants/{tenant}/events';

function trimUrl(u: string): string {
  return u.trim().replace(/\/+$/, '');
}

/**
 * Decode a JWT payload (middle segment) without verifying the signature — we
 * only read the self-describing `server_url` / `sub` claims. base64url-safe;
 * returns `{}` on any malformed input (never throws).
 */
export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length < 2) return {};
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const json =
      typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Resolve Hatchet config, or `null` when no token / unresolvable. Pure + total.
 * `serverUrl`/`tenantId` come from the JWT claims; `HATCHET_SERVER_URL` /
 * `HATCHET_TENANT_ID` / `HATCHET_EVENTS_PATH` override.
 *
 * @param env - Worker env (reads `HATCHET_API_TOKEN` + overrides).
 * @returns A {@link HatchetConfig}, or `null` to signal "orchestration disabled".
 */
export function resolveHatchet(env: Env): HatchetConfig | null {
  const e = env as {
    HATCHET_API_TOKEN?: string;
    HATCHET_SERVER_URL?: string;
    HATCHET_TENANT_ID?: string;
    HATCHET_EVENTS_PATH?: string;
  };
  const token = e.HATCHET_API_TOKEN?.trim();
  if (!token) return null;
  const claims = decodeJwtPayload(token);
  const serverUrl =
    e.HATCHET_SERVER_URL?.trim() ||
    (typeof claims.server_url === 'string' ? claims.server_url : '');
  const tenantId =
    e.HATCHET_TENANT_ID?.trim() || (typeof claims.sub === 'string' ? claims.sub : '');
  if (!serverUrl || !tenantId) return null;
  return {
    serverUrl: trimUrl(serverUrl),
    tenantId,
    token,
    eventsPath: e.HATCHET_EVENTS_PATH?.trim() || DEFAULT_EVENTS_PATH,
  };
}

/**
 * Authed fetch against the Hatchet shard — prepends `serverUrl`, attaches the
 * Bearer token + JSON headers. Never throws (resolves to a 599 sentinel Response
 * on a network error so callers branch on status only).
 *
 * @param env - Worker env.
 * @param path - Path beginning with `/` (appended to `serverUrl`).
 * @param init - Fetch init; headers are merged (Authorization always set).
 * @param deps - Optional `{ fetchImpl }` for tests.
 */
export async function hatchetAuthedFetch(
  env: Env,
  path: string,
  init: RequestInit = {},
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<Response> {
  const cfg = resolveHatchet(env);
  if (!cfg) return new Response('hatchet not configured', { status: 599 });
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    return await doFetch(`${cfg.serverUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    return new Response('hatchet network error', { status: 599 });
  }
}

/** Outcome of a Hatchet event push. */
export interface HatchetPushResult {
  ok: boolean;
  reason?: 'not_configured' | 'http_error' | 'network_error';
  status?: number;
}

/**
 * Push an event to Hatchet (the outbox's dispatch target). Fire-and-forget,
 * never throws. Body shape: `{ key, data, additionalMetadata? }` — the Hatchet
 * event envelope. The `599` sentinel from {@link hatchetAuthedFetch} maps to a
 * `not_configured`/`network_error` reason so the outbox keeps the row pending.
 *
 * @param env - Worker env.
 * @param key - Event key Hatchet workflows subscribe to (e.g. `site.published`).
 * @param data - Event payload.
 * @param opts - `{ metadata, fetchImpl }`.
 * @returns A {@link HatchetPushResult}.
 */
export async function pushHatchetEvent(
  env: Env,
  key: string,
  data: Record<string, unknown>,
  opts: { metadata?: Record<string, string>; fetchImpl?: typeof fetch } = {},
): Promise<HatchetPushResult> {
  const cfg = resolveHatchet(env);
  if (!cfg) return { ok: false, reason: 'not_configured' };
  const path = cfg.eventsPath.replace('{tenant}', encodeURIComponent(cfg.tenantId));
  const body = JSON.stringify({
    key,
    data,
    ...(opts.metadata ? { additionalMetadata: opts.metadata } : {}),
  });
  const res = await hatchetAuthedFetch(env, path, { method: 'POST', body }, opts);
  if (res.status === 599) return { ok: false, reason: 'network_error' };
  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };
  return { ok: true, status: res.status };
}
