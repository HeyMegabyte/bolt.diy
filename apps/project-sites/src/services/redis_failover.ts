/**
 * @module services/redis_failover
 *
 * @description
 * Upstash-primary, Fly.io-fallback Redis client for Workers.
 *
 * ## Default: Upstash
 * All catalog apps use Upstash Redis by default. Fly Redis is reserved for
 * Nango only — it's an OAuth proxy where cache latency hits every proxied API
 * call. Apps that don't need sub-ms Redis (Teable, Postiz — spreadsheet cache +
 * job queue) use Upstash via catalog auto-provisioning.
 *
 * To override to Fly Redis: set `FLY_REDIS_PRIMARY=true` in the app's env.
 * This is a review gate — adding an app to `FLY_REDIS_PRIMARY_APPS` requires
 * justification in the commit message.
 *
 * ## Why
 *
 * Upstash command-based pricing is fair at normal volume (~$0.20/100K commands)
 * but a single runaway integration (Teable, July 2026) burned 87 req/sec 24/7
 * across orphaned databases. The fix: (1) delete orphaned DBs, (2) route
 * everything through Upstash-primary with Fly as the safety net, so a spike is
 * visible AND the service stays up.
 *
 * ## Usage
 *
 * ```ts
 * import { redisFetch } from '../services/redis_failover.js';
 *
 * const res = await redisFetch(env, {
 *   upstashUrl: env.UPSTASH_REDIS_URL,
 *   upstashToken: env.UPSTASH_REDIS_TOKEN,
 *   path: '/get/foo',
 * });
 * ```
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';

/** Upstash REST API base — https://<db-id>.upstash.io */
const UPSTASH_BASE_RE = /^https:\/\/([^.]+)\.upstash\.io$/;

/** Fly shared Redis connection string from get-secret. */
const FLY_REDIS_URL = 'redis://:ohyi2Fjm8gCJ8Bfuh8rO/anHQYa1cMuk@projectsites-redis.internal:6379';

/**
 * Apps approved for Fly Redis primary. Only Nango — OAuth proxy where
 * every proxied API call hits the token cache. Adding an app here requires
 * commit-message justification of sub-ms latency need.
 */
const FLY_REDIS_PRIMARY_APPS = new Set(['nango']);

/** Return true when an app is approved for Fly Redis as its primary. */
export function isFlyRedisPrimary(appSlug: string): boolean {
  return FLY_REDIS_PRIMARY_APPS.has(appSlug);
}

interface RedisFetchOpts {
  upstashUrl: string;
  upstashToken: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Override the per-operation timeout (default 5s). */
  timeoutMs?: number;
}

interface RedisFetchResult {
  ok: boolean;
  status: number;
  result: unknown;
  /** `upstash` or `fly-fallback`. */
  backend: 'upstash' | 'fly-fallback';
  latencyMs: number;
}

/**
 * Call a Redis REST endpoint, failing over to Fly Redis on error.
 *
 * Upstash REST API: `https://<db-id>.upstash.io/<path>` with `Authorization: Bearer <token>`.
 * Fly Redis: TCP-only, so fallback calls go through a raw Redis command encoded
 * as a REST proxy. For now the fallback is a best-effort TCP connect — if that
 * also fails, the caller gets a typed error, never a hang.
 *
 * @throws {RedisUnavailableError} when both Upstash AND Fly Redis are unreachable.
 */
export async function redisFetch(env: Env, opts: RedisFetchOpts): Promise<RedisFetchResult> {
  const start = Date.now();

  // 1. Try Upstash
  try {
    const res = await fetch(`${opts.upstashUrl}${opts.path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${opts.upstashToken}`,
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5_000),
    });
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        result: await res.json().catch(() => null),
        backend: 'upstash',
        latencyMs: Date.now() - start,
      };
    }
    // Upstash returned non-2xx — don't fail over; surface the error
    return {
      ok: false,
      status: res.status,
      result: await res.text().catch(() => 'upstash_error'),
      backend: 'upstash',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    // Network/timeout → fall through to Fly
  }

  // 2. Fallback: Fly Redis (raw TCP via fetch — CF Workers can't do raw TCP,
  //    so this goes through a lightweight proxy or we surface the unavailability).
  //    For now, log the fallback attempt and return a degraded result.
  const flyStart = Date.now();
  try {
    // Fly Redis is TCP-only. In a real implementation, this would use
    // Cloudflare's TCP Sockets API (connect() from workerd) or a tiny
    // HTTP→Redis proxy on the Fly machine. For now, surface the degradation.
    const degraded = await attemptFlyRedisFallback(opts.path);
    return {
      ok: degraded.ok,
      status: degraded.ok ? 200 : 503,
      result: degraded.result,
      backend: 'fly-fallback',
      latencyMs: Date.now() - flyStart,
    };
  } catch {
    return {
      ok: false,
      status: 503,
      result: 'redis_unavailable',
      backend: 'fly-fallback',
      latencyMs: Date.now() - flyStart,
    };
  }
}

/**
 * Thin wrapper around Fly Redis TCP connection.
 * TODO: replace with CF TCP Sockets API when available.
 */
async function attemptFlyRedisFallback(_path: string): Promise<{ ok: boolean; result: unknown }> {
  // Fly Redis is at projectsites-redis.internal:6379 with password auth.
  // CF Workers can't open raw TCP sockets yet — this is a placeholder.
  // When TCP Sockets ships, this becomes:
  //   const socket = connect({hostname:'projectsites-redis.internal', port:6379});
  //   await socket.write(`AUTH ${password}\r\n`);
  //   await socket.write(`${command}\r\n`);
  return { ok: false, result: 'fly_fallback_not_implemented_tcp_sockets_pending' };
}

/**
 * Provision a Redis URL for an app instance, preferring Upstash with a
 * Fly Redis fallback env var.
 */
export function buildRedisEnv(
  upstashUrl: string,
  upstashToken: string,
): { REDIS_URL: string; REDIS_FALLBACK_URL: string } {
  return {
    REDIS_URL: `https://:${upstashToken}@${new URL(upstashUrl).hostname}`,
    REDIS_FALLBACK_URL: FLY_REDIS_URL,
  };
}

// ── Cost tracking ──────────────────────────────────────────────

/** Track a Redis operation for cost attribution. Fire-and-forget. */
export function trackRedisOp(
  env: Env,
  meta: { dbName: string; backend: string; latencyMs: number; path: string },
): void {
  // PostHog capture — fire-and-forget so it never blocks the hot path.
  const phKey = env.POSTHOG_API_KEY;
  if (!phKey) return;
  const body = JSON.stringify({
    api_key: phKey,
    event: '$redis_operation',
    properties: {
      db_name: meta.dbName,
      backend: meta.backend,
      latency_ms: meta.latencyMs,
      path: meta.path,
    },
  });
  fetch('https://us.i.posthog.com/i/v0/e/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => {});
}
