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
import { setUser as sentrySetUser } from '../lib/sentry.js';

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
        const hash = Array.from(new Uint8Array(hashBytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
        const key = await dbQueryOne<{ id: string; org_id: string; created_by: string; expires_at: string | null }>(
          c.env.DB,
          `SELECT id, org_id, created_by, expires_at FROM api_keys
           WHERE hash = ? AND revoked_at IS NULL LIMIT 1`,
          [hash],
        );
        if (key && (!key.expires_at || new Date(key.expires_at).getTime() > Date.now())) {
          c.set('userId', key.created_by);
          c.set('orgId', key.org_id);
          // Best-effort last-used timestamp; failure must not block the request.
          c.executionCtx.waitUntil(
            c.env.DB.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`)
              .bind(key.id).run().catch(() => undefined) as Promise<unknown>,
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

  // After session resolution, attach the authenticated identity to the
  // request's Sentry scope so any error reported downstream carries user +
  // org tags. Best-effort; failures never block the request.
  const userId = c.get('userId');
  if (userId) {
    sentrySetUser(c, { id: userId, orgId: c.get('orgId') });
  }

  await next();
};
