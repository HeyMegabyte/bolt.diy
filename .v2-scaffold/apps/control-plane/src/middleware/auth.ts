/**
 * Auth middleware: cookie (`ps_session`) OR `Authorization: Bearer ...` → userId/orgId.
 *
 * Does NOT reject unauthenticated callers — routes opt in via `requireAuth()`.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import { getCookie } from 'hono/cookie';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';

interface SessionRow {
  user_id: string;
  org_id: string | null;
  email: string;
  expires_at: number;
}

export const authMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  c.set('requestId', c.req.header('x-request-id') ?? crypto.randomUUID());
  c.set('userId', null);
  c.set('userEmail', null);
  c.set('orgId', null);
  c.set('isSuperAdmin', false);
  c.set('viewAs', c.req.header('x-view-as') ?? null);
  c.set('tenantId', c.req.header('x-tenant-id') ?? null);

  const token = readSessionToken(c);
  if (!token) {
    return next();
  }

  const row = await c.env.DB.prepare(
    `SELECT s.user_id, s.org_id, u.email, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ?1 AND s.expires_at > ?2 AND s.revoked_at IS NULL`,
  )
    .bind(token, Date.now())
    .first<SessionRow>();

  if (row) {
    c.set('userId', row.user_id);
    c.set('userEmail', row.email);
    c.set('orgId', row.org_id);
    // Server-verified super-admin: NEVER trust a client flag.
    c.set('isSuperAdmin', row.email === c.env.SUPER_ADMIN_EMAIL);
  }

  return next();
};

/** Helper for routes to require an authenticated session. */
export function requireAuth(c: Context<HonoEnv>): string {
  const userId = c.get('userId');
  if (!userId) throw new AppError(ErrorCode.UNAUTHORIZED, 'authentication required');
  return userId;
}

/** Helper for routes that must be the global super-admin. Re-checks email server-side. */
export function requireSuperAdmin(c: Context<HonoEnv>): void {
  requireAuth(c);
  if (!c.get('isSuperAdmin')) {
    throw new AppError(ErrorCode.FORBIDDEN, 'super-admin only');
  }
  if (c.get('userEmail') !== c.env.SUPER_ADMIN_EMAIL) {
    throw new AppError(ErrorCode.FORBIDDEN, 'super-admin email mismatch');
  }
}

function readSessionToken(c: Context<HonoEnv>): string | null {
  const cookie = getCookie(c, 'ps_session');
  if (cookie) return cookie;
  const auth = c.req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}
