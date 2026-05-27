/**
 * GET /api/me — current user, tenants, capabilities, **server-verified** super-admin
 * flag. Never trust a client claim — `isSuperAdmin` is recomputed here.
 */

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import type { Capability, HonoEnv } from '../types.js';
import { dbQuery, dbQueryOne } from '../services/db.js';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  totp_enabled: number;
}

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  role: string;
  status: string;
}

const app = new Hono<HonoEnv>();

app.get('/', async (c) => {
  const userId = requireAuth(c);
  const user = await dbQueryOne<UserRow>(
    c.env.DB,
    `SELECT id, email, name, avatar_url, totp_enabled FROM users WHERE id = ?1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!user) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'user not found' } }, 404);
  }

  const tenants = await dbQuery<TenantRow>(
    c.env.DB,
    `SELECT t.id, t.slug, t.name, tm.role, t.status
     FROM team_members tm
     JOIN tenants t ON t.id = tm.tenant_id
     WHERE tm.user_id = ?1 AND tm.deleted_at IS NULL AND t.deleted_at IS NULL`,
    [userId],
  );

  const currentTenantId = c.get('tenantId') ?? tenants[0]?.id ?? null;
  const currentTenant = currentTenantId
    ? (tenants.find((t) => t.id === currentTenantId) ?? null)
    : null;

  // Server-verified super-admin (re-check)
  const isSuperAdmin = user.email === c.env.SUPER_ADMIN_EMAIL;

  const capabilities = computeCapabilities(currentTenant?.role ?? null, isSuperAdmin);

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      totp_enabled: user.totp_enabled === 1,
    },
    tenants,
    currentTenant,
    capabilities,
    isSuperAdmin,
  });
});

function computeCapabilities(role: string | null, isSuperAdmin: boolean): Capability[] {
  if (isSuperAdmin) {
    return [
      'billing.read',
      'billing.write',
      'sites.read',
      'sites.write',
      'sites.delete',
      'team.read',
      'team.write',
      'integrations.read',
      'integrations.write',
      'jobs.read',
      'jobs.write',
      'admin.sql',
    ];
  }
  if (!role) return [];
  if (role === 'owner') {
    return [
      'billing.read',
      'billing.write',
      'sites.read',
      'sites.write',
      'sites.delete',
      'team.read',
      'team.write',
      'integrations.read',
      'integrations.write',
      'jobs.read',
      'jobs.write',
    ];
  }
  if (role === 'admin') {
    return [
      'billing.read',
      'sites.read',
      'sites.write',
      'team.read',
      'team.write',
      'integrations.read',
      'integrations.write',
      'jobs.read',
      'jobs.write',
    ];
  }
  if (role === 'staff') {
    return ['sites.read', 'team.read', 'jobs.read', 'jobs.write'];
  }
  if (role === 'crew') return ['jobs.read', 'jobs.write'];
  if (role === 'customer') return ['jobs.read'];
  return [];
}

export default app;
