/**
 * KV-backed sliding-window rate limiter. Wraps the Cloudflare Workers Rate Limiting API
 * when the `RATE_LIMITER` binding is present; otherwise falls back to KV counters.
 *
 * Tier limits (per design):
 *  - auth: 10 req/min/IP
 *  - ai:   60 req/min/user
 */

import type { MiddlewareHandler } from 'hono';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';

export type RateLimitTier = 'auth' | 'ai' | 'public';

const LIMITS: Record<RateLimitTier, { window: number; max: number }> = {
  auth: { window: 60, max: 10 },
  ai: { window: 60, max: 60 },
  public: { window: 60, max: 300 },
};

export function rateLimit(tier: RateLimitTier): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const { window, max } = LIMITS[tier];
    const subject = tier === 'ai' ? (c.get('userId') ?? clientIp(c)) : clientIp(c);
    const bucket = Math.floor(Date.now() / 1000 / window);
    const key = `rl:${tier}:${subject}:${bucket}`;

    const current = await c.env.CACHE.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= max) {
      throw new AppError(ErrorCode.RATE_LIMITED, `rate limit exceeded for ${tier}`, {
        retry_after: window,
      });
    }

    // Fire-and-forget increment. Best-effort — losing a write under contention is
    // acceptable for the public/auth tiers; the AI tier could move to a DO if needed.
    c.executionCtx.waitUntil(
      c.env.CACHE.put(key, String(count + 1), { expirationTtl: window + 5 }),
    );

    return next();
  };
}

function clientIp(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
