/**
 * @module middleware/auth
 * @description Bearer-token authentication middleware for Hono.
 *
 * Extracts a session token from the `Authorization: Bearer <token>` header,
 * validates it against D1, and populates `c.set('userId')` and `c.set('orgId')`
 * on the Hono context. If no token is present or the session is invalid, the
 * request continues without auth context -- individual routes decide whether
 * authentication is required.
 *
 * @packageDocumentation
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { getSession } from '../services/auth.js';
import { dbQueryOne } from '../services/db.js';
import { safeWaitUntil } from '../lib/wait-until.js';
// NOTE: `makeAuth` is lazy-imported at its single callsite below (inside the
// `better_auth` flag gate) — the better-auth npm pkg pulls a deep ESM-only dep
// tree, and eagerly importing it here made it load at module-eval, crashing every
// jest suite that imports this middleware (@swc/jest can't transcompile the tree).
// Dynamic import keeps it out of the module graph until the flag is actually on.
import { isFlagOn } from '../modules/feature_flags/services.js';

/**
 * Auth middleware that optionally populates userId and orgId on the Hono context.
 *
 * Does **not** reject unauthenticated requests -- routes that require auth
 * should check `c.get('userId')` and throw `unauthorized()` themselves.
 *
 * @example
 * ```ts
 * import { authMiddleware } from './middleware/auth.js';
 * app.use('/api/*', authMiddleware);
 * ```
 */
export const authMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    if (token) {
      // Org-scoped API keys (psk_live_…) — match by SHA-256 of the secret.
      // These authenticate as the org creator, so all subsequent code that
      // reads userId + orgId from context Just Works.
      if (token.startsWith('psk_live_') || token.startsWith('psk_test_')) {
        const hashBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
        const hash = Array.from(new Uint8Array(hashBytes))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const key = await dbQueryOne<{
          id: string;
          org_id: string;
          created_by: string;
          expires_at: string | null;
        }>(
          c.env.DB,
          `SELECT id, org_id, created_by, expires_at FROM api_keys
           WHERE hash = ? AND revoked_at IS NULL LIMIT 1`,
          [hash],
        );
        if (key && (!key.expires_at || new Date(key.expires_at).getTime() > Date.now())) {
          c.set('userId', key.created_by);
          c.set('orgId', key.org_id);
          // Best-effort last-used timestamp; failure must not block the request.
          // safeWaitUntil tolerates a missing ExecutionContext (internal/test
          // invocations) — a bare c.executionCtx.waitUntil would crash there.
          safeWaitUntil(
            c,
            c.env.DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`)
              .bind(key.id)
              .run()
              .catch(() => undefined) as Promise<unknown>,
          );
        }
      } else {
        const session = await getSession(c.env.DB, token);

        if (session) {
          c.set('userId', session.user_id);

          // Look up the user's primary org
          const membership = await dbQueryOne<{ org_id: string }>(
            c.env.DB,
            'SELECT m.org_id FROM memberships m WHERE m.user_id = ? AND m.deleted_at IS NULL LIMIT 1',
            [session.user_id],
          );

          if (membership) {
            c.set('orgId', membership.org_id);
          }
        }
      }
    }
  }

  // Better Auth session bridge (cutover) — when the `better_auth` flag is on and
  // no token-based auth matched, resolve the Better Auth COOKIE session so authed
  // API calls work for users signed in via Better Auth. Backfilled BA users reuse
  // the legacy user id, so org resolution reuses the same `memberships` lookup.
  // Best-effort: only runs when no bearer token authenticated the request.
  if (!c.get('userId')) {
    try {
      if (await isFlagOn(c.env, 'better_auth')) {
        const { makeAuth } = await import('../auth/better-auth.js');
        const ba = (await makeAuth(c.env).api.getSession({ headers: c.req.raw.headers })) as {
          user?: { id?: string };
        } | null;
        const uid = ba?.user?.id;
        if (uid) {
          c.set('userId', uid);
          const membership = await dbQueryOne<{ org_id: string }>(
            c.env.DB,
            'SELECT m.org_id FROM memberships m WHERE m.user_id = ? AND m.deleted_at IS NULL LIMIT 1',
            [uid],
          );
          if (membership) {
            c.set('orgId', membership.org_id);
          }
        }
      }
    } catch {
      /* Better Auth session resolution is best-effort — never block the request */
    }
  }

  await next();
};
