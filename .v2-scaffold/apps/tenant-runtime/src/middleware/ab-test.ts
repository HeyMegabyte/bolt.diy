/**
 * A/B test middleware — 50/50 split, KV-routed, sticky per visitor.
 *
 * @remarks
 *  - Reads `ab_test:{siteId}:{path}` from KV. Empty/missing = experiment off,
 *    pass through with `x-ab-variant: control`.
 *  - Visitor bucketing is deterministic: SHA-1 of the `ps_ab` cookie (set
 *    server-side on first hit) modulo 100. Buckets 0-49 = variant A, 50-99 =
 *    variant B. Same visitor always gets the same variant for the same path.
 *  - Stats counters live in KV under `ab_stats:{siteId}:{path}:{variant}` and
 *    are incremented per request (best-effort; KV write failures don't break
 *    the request).
 *  - Sets `x-ab-variant: A|B|control` on the response so downstream caches +
 *    edge logs can attribute traffic.
 *
 * @example
 *   app.use('*', abTestMiddleware());
 *
 * @see ARCHITECTURE.md § "Experiments + flags"
 */
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppContext } from '../env';

export type AbVariant = 'A' | 'B' | 'control';

/** KV value shape — JSON-encoded under `ab_test:{siteId}:{path}`. */
export interface AbTestConfig {
  /** Required to be `true` for the split to activate. */
  enabled: boolean;
  /** Optional split weight 0–100; defaults to 50 (= 50/50). */
  weight_a?: number;
  /** Optional ISO-8601 expiry. Once past, the experiment is treated as off. */
  expires_at?: string;
}

/**
 * Hono middleware. Reads the per-path experiment config from KV, assigns the
 * visitor to A or B (or `control` when off), increments the variant counter,
 * and exposes the variant via the `x-ab-variant` response header.
 */
export function abTestMiddleware(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const siteId = c.env.TENANT_ID;
    const url = new URL(c.req.url);
    const path = url.pathname;
    const key = `ab_test:${siteId}:${path}`;

    let variant: AbVariant = 'control';
    let configRaw: string | null = null;
    try {
      configRaw = await c.env.KV.get(key);
    } catch {
      // KV outage → experiment off; never break the page render.
      configRaw = null;
    }

    if (configRaw) {
      const config = parseConfig(configRaw);
      const expired =
        !!config?.expires_at && new Date(config.expires_at).getTime() < Date.now();
      if (config?.enabled && !expired) {
        const visitorId = readOrSetVisitor(c);
        const bucket = await bucketFor(visitorId, path);
        const weightA = clampWeight(config.weight_a ?? 50);
        variant = bucket < weightA ? 'A' : 'B';

        // Best-effort counter (read-modify-write). Eventual consistency is
        // acceptable for a 30-day experiment window.
        const statKey = `ab_stats:${siteId}:${path}:${variant}`;
        try {
          const current = await c.env.KV.get(statKey);
          const nextVal = (current ? parseInt(current, 10) : 0) + 1;
          await c.env.KV.put(statKey, String(nextVal), {
            expirationTtl: 60 * 60 * 24 * 60, // 60d
          });
        } catch {
          // ignore stat failures
        }
      }
    }

    await next();
    c.res.headers.set('x-ab-variant', variant);
  };
}

function parseConfig(raw: string): AbTestConfig | null {
  try {
    return JSON.parse(raw) as AbTestConfig;
  } catch {
    return null;
  }
}

/** Cookie that sticks a visitor to a bucket across requests. 365d expiry. */
function readOrSetVisitor(c: Context<AppContext>): string {
  const existing = getCookie(c, 'ps_ab');
  if (existing) return existing;
  const id = crypto.randomUUID();
  setCookie(c, 'ps_ab', id, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: true,
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
  });
  return id;
}

/** Deterministic bucket 0-99 for a (visitor, path) pair. */
async function bucketFor(visitorId: string, path: string): Promise<number> {
  const data = new TextEncoder().encode(`${visitorId}:${path}`);
  const hashBuf = await crypto.subtle.digest('SHA-1', data);
  const bytes = new Uint8Array(hashBuf);
  // Use first 4 bytes as an unsigned int32, modulo 100.
  const n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return n % 100;
}

function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 50;
  if (w < 0) return 0;
  if (w > 100) return 100;
  return Math.floor(w);
}
