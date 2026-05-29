/**
 * @module libs/features/agency_white_label/handlers
 * @description Hono routes for the White-Label Agency Tier (idea #34).
 *
 * | Method | Path                                  | Purpose                                |
 * | ------ | ------------------------------------- | -------------------------------------- |
 * | GET    | /api/agency-white-label               | List tenants for caller's org          |
 * | POST   | /api/agency-white-label               | Create a new white-label tenant        |
 * | GET    | /api/agency-white-label/:id           | Get one tenant                         |
 * | PATCH  | /api/agency-white-label/:id           | Update brand chrome                    |
 * | GET    | /api/agency-white-label/by-host/:host | Public: resolve chrome by hostname     |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  CreateAgencyRequestSchema,
  UpdateAgencyRequestSchema,
} from './schemas.js';
import {
  createTenant,
  getTenantById,
  listTenantsForOrg,
  resolveBrandChrome,
  updateTenant,
} from './service.js';

export const FLAG_KEY = 'agency_white_label';

type AppContext = { Bindings: Env; Variables: Variables };

export const agencyWhiteLabel = new Hono<AppContext>();

async function guard(
  c: import('hono').Context<AppContext>,
): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  return null;
}

agencyWhiteLabel.get('/api/agency-white-label', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId') as string;
  const tenants = await listTenantsForOrg(c.env.DB, orgId);
  return c.json({ tenants });
});

agencyWhiteLabel.post('/api/agency-white-label', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const raw = await c.req.json().catch(() => ({}));
  const parsed = CreateAgencyRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid agency tenant payload',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }
  const userId = c.get('userId') as string;
  const orgId = (c.get('orgId') as string | undefined) ?? userId;
  const { tier, ...config } = parsed.data;
  const tenant = await createTenant(c.env.DB, {
    ownerUserId: userId,
    ownerOrgId: orgId,
    tier,
    config,
  });
  return c.json({ tenant }, 201);
});

agencyWhiteLabel.get('/api/agency-white-label/:id', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const orgId = c.get('orgId') as string;
  const tenant = await getTenantById(c.env.DB, c.req.param('id'));
  if (!tenant || tenant.owner_org_id !== orgId) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  return c.json({ tenant });
});

agencyWhiteLabel.patch('/api/agency-white-label/:id', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const raw = await c.req.json().catch(() => ({}));
  const parsed = UpdateAgencyRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid update payload',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }
  const orgId = c.get('orgId') as string;
  const tenant = await updateTenant(c.env.DB, {
    id: c.req.param('id'),
    ownerOrgId: orgId,
    patch: parsed.data,
  });
  if (!tenant) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  return c.json({ tenant });
});

/**
 * Public hostname-router lookup — no auth required because the brand chrome
 * is intentionally public (it's what visitors see). Still flag-gated.
 */
agencyWhiteLabel.get('/api/agency-white-label/by-host/:host', async (c) => {
  const on = await isFlagOn(c.env, FLAG_KEY, {});
  if (!on) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const chrome = await resolveBrandChrome(c.env.DB, c.req.param('host'));
  if (!chrome) return c.json({ chrome: null });
  return c.json({ chrome });
});
