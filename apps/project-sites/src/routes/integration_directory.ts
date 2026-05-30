/**
 * @module routes/integration_directory
 * @description Integration Directory routes (feature #30).
 *
 * Mounted at `/api/sites/:id/integrations/*`. Every route is gated by the
 * shared {@link requireOrgFlag} (auth → `integration_directory` flag → org
 * scope) and then enforces **site ownership**: the `:id` site must belong to
 * the caller's org, or the route returns 404 (never 403 — don't leak another
 * org's site existence). This closes a multi-tenant isolation gap where the
 * read/generate/publish routes previously trusted the URL `:id` without
 * verifying tenancy.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import {
  badRequest,
  notFound,
  requireOrgFlag,
  type AppCtx,
  type OrgScope,
} from '../lib/feature_guard.js';
import {
  IntegrationGenerateRequestSchema,
  IntegrationPublishRequestSchema,
  IntegrationSeedRequestSchema,
} from '../../libs/features/integration_directory/feature.schemas.js';
import {
  FLAG_KEY,
  generatePages,
  listPages,
  listServices,
  publishPages,
  seedServices,
  siteOrgId,
} from '../services/integration_directory.js';

const integ = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Run the auth+flag gate, then assert the `:id` site is owned by the caller's
 * org. Returns the {@link OrgScope} + resolved `siteId` to proceed, or a
 * short-circuit `Response` (401 unauth / 404 flag-off / 404 cross-org).
 */
async function gateOwnedSite(c: AppCtx): Promise<{ scope: OrgScope; siteId: string } | Response> {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  const siteId = c.req.param('id');
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== g.orgId) return notFound(c); // missing OR not yours → 404
  return { scope: g, siteId };
}

integ.get('/:id/integrations/services', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;
  const services = await listServices(c.env, gate.siteId);
  return c.json({ services });
});

integ.post('/:id/integrations/seed', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;

  const body = await c.req.json().catch(() => null);
  const parsed = IntegrationSeedRequestSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const result = await seedServices(c.env, gate.siteId, gate.scope.orgId, parsed.data.services);
  return c.json({ ok: true, ...result });
});

integ.post('/:id/integrations/generate', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;

  const body = await c.req.json().catch(() => ({}));
  const parsed = IntegrationGenerateRequestSchema.safeParse(body ?? {});
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const result = await generatePages(c.env, gate.siteId, gate.scope.orgId, parsed.data);
  return c.json({ ok: true, ...result });
});

integ.get('/:id/integrations/pages', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;
  const status = c.req.query('status');
  const pages = await listPages(c.env, gate.siteId, status);
  return c.json({ pages });
});

integ.post('/:id/integrations/publish', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;

  const body = await c.req.json().catch(() => null);
  const parsed = IntegrationPublishRequestSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const result = await publishPages(c.env, gate.siteId, parsed.data.pageIds);
  return c.json({ ok: true, ...result });
});

export { integ as integrationDirectoryRoutes };
