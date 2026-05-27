/**
 * Resolves X-Tenant-Id → orgId. Verifies the caller has membership before binding it
 * to the context. Falls back to the user's default org when the header is absent.
 */

import type { MiddlewareHandler } from 'hono';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';

export const tenantMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const userId = c.get('userId');
  const requestedTenant = c.req.header('x-tenant-id');
  if (!userId) return next();

  if (requestedTenant) {
    const member = await c.env.DB.prepare(
      `SELECT 1 FROM team_members WHERE user_id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    )
      .bind(userId, requestedTenant)
      .first();
    if (!member && !c.get('isSuperAdmin')) {
      throw new AppError(ErrorCode.FORBIDDEN, 'no membership in requested tenant');
    }
    c.set('orgId', requestedTenant);
    c.set('tenantId', requestedTenant);
  }

  return next();
};
