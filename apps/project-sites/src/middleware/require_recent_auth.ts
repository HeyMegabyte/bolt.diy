/**
 * @module middleware/require_recent_auth
 *
 * @description
 * Step-up (re-authentication) guard for sensitive actions (new-50 #2). Sensitive
 * operations — changing billing, deleting an org, rotating API keys, disabling 2FA
 * — should require that the caller authenticated RECENTLY, not merely that they
 * hold a long-lived session. This middleware reads the Better Auth session and
 * rejects with **401 `REAUTH_REQUIRED`** when the session is older than a freshness
 * window, so the client can prompt a quick re-auth (which mints a fresh session).
 *
 * Ships dark with Better Auth: pre-cutover there is no BA session, so it 401s
 * safely; post-cutover it enforces step-up on the routes it wraps.
 */
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { Env } from '../types/env.js';
// makeAuth is lazy-imported at the callsite — better-auth's ESM dep tree breaks
// jest module-eval; dynamic import keeps it out of the graph until invoked.

/** Default freshness window: a session authenticated within 15 minutes is "recent". */
export const DEFAULT_FRESH_WINDOW_SECONDS = 15 * 60;

/** Minimal Better Auth shape this module calls (keeps tests light). */
export interface SessionAuthLike {
  readonly api: {
    getSession: (opts: { headers: Headers }) => Promise<{
      session?: { createdAt?: string | number | Date };
    } | null>;
  };
}

/** Coerce Better Auth's `createdAt` (Date | ISO string | epoch ms) to epoch ms, or null. */
function toEpochMs(v: string | number | Date | undefined): number | null {
  if (v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Age (seconds) of the caller's session, or `null` when there is no session / no
 * parseable `createdAt`. Never throws.
 *
 * @param auth - Better Auth instance (or a stub exposing `api.getSession`).
 * @param headers - Incoming request headers (carry the session).
 * @param nowMs - Current time in epoch ms (injected for deterministic tests).
 * @returns Session age in seconds, or `null`.
 */
export async function sessionAgeSeconds(
  auth: SessionAuthLike,
  headers: Headers,
  nowMs: number,
): Promise<number | null> {
  try {
    const res = await auth.api.getSession({ headers });
    const createdMs = toEpochMs(res?.session?.createdAt);
    if (createdMs === null) return null;
    return Math.max(0, Math.floor((nowMs - createdMs) / 1000));
  } catch {
    return null;
  }
}

/** True when a session of `ageSeconds` is fresh enough for `maxAgeSeconds`. */
export function isRecentEnough(ageSeconds: number | null, maxAgeSeconds: number): boolean {
  return ageSeconds !== null && ageSeconds <= maxAgeSeconds;
}

/**
 * Hono middleware requiring a session authenticated within `maxAgeSeconds`.
 * Responds **401 `{ code: 'REAUTH_REQUIRED' }`** when the session is absent or stale.
 *
 * @param maxAgeSeconds - Freshness window (default {@link DEFAULT_FRESH_WINDOW_SECONDS}).
 *
 * @example
 * app.post('/api/org/delete', requireRecentAuth(), deleteOrgHandler); // re-auth within 15m
 * app.post('/api/keys/rotate', requireRecentAuth(5 * 60), rotateHandler); // stricter 5m
 */
export function requireRecentAuth(
  maxAgeSeconds: number = DEFAULT_FRESH_WINDOW_SECONDS,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const { makeAuth } = await import('../auth/better-auth.js');
    const auth = makeAuth(c.env) as unknown as SessionAuthLike;
    const age = await sessionAgeSeconds(auth, c.req.raw.headers, Date.now());
    if (!isRecentEnough(age, maxAgeSeconds)) {
      return c.json(
        {
          error: {
            code: 'REAUTH_REQUIRED',
            message: 'Please re-authenticate to continue.',
            max_age_seconds: maxAgeSeconds,
          },
        },
        401,
      );
    }
    return next();
  };
}
