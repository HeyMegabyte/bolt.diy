/**
 * X-View-As mirror. Super-admin may impersonate a role to test gated UI; everyone else
 * may only "view-as" a less-privileged role they actually hold. The /api/* surface
 * scopes data accordingly so the admin SPA renders identically to the real role.
 */

import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';

const ALLOWED_ROLES = new Set(['owner', 'admin', 'staff', 'customer', 'crew']);

export const viewAsMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const header = c.req.header('x-view-as');
  if (header && ALLOWED_ROLES.has(header)) {
    c.set('viewAs', header);
  }
  return next();
};
