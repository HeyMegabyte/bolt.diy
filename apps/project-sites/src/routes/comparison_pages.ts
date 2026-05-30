/**
 * @module routes/comparison_pages
 * @description Comparison Pages Engine routes (feature #31).
 *
 * Mounted at `/api/sites/:id/comparisons/*`. Every route is gated by the shared
 * {@link requireOrgFlag} (auth → `comparison_pages` flag → org scope) and then
 * enforces **site ownership**: the `:id` site must belong to the caller's org,
 * or the route returns 404 (never 403 — don't leak another org's site). This
 * closes a multi-tenant isolation gap where competitors/generate/pages/refresh
 * previously trusted the URL `:id` without verifying tenancy.
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
  ComparisonGenerateRequestSchema,
  CompetitorSeedRequestSchema,
  RefreshPricingRequestSchema,
} from '../../libs/features/comparison_pages/feature.schemas.js';
import {
  FLAG_KEY,
  generatePages,
  listCompetitors,
  listPages,
  refreshPricing,
  seedCompetitors,
  siteOrgId,
} from '../services/comparison_pages.js';

const cmp = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Run the auth+flag gate, then assert the `:id` site is owned by the caller's
 * org. Returns the {@link OrgScope} + resolved `siteId` to proceed, or a
 * short-circuit `Response` (401 unauth / 404 flag-off / 404 cross-org / 404 missing).
 */
async function gateOwnedSite(c: AppCtx): Promise<{ scope: OrgScope; siteId: string } | Response> {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  const siteId = c.req.param('id');
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== g.orgId) return notFound(c); // missing OR not yours → 404
  return { scope: g, siteId };
}

cmp.get('/:id/comparisons/competitors', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;
  const competitors = await listCompetitors(c.env, gate.siteId);
  return c.json({ competitors });
});

cmp.post('/:id/comparisons/competitors', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;

  const body = await c.req.json().catch(() => null);
  const parsed = CompetitorSeedRequestSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const result = await seedCompetitors(
    c.env,
    gate.siteId,
    gate.scope.orgId,
    parsed.data.competitors,
  );
  return c.json({ ok: true, ...result });
});

cmp.post('/:id/comparisons/generate', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;

  const body = await c.req.json().catch(() => null);
  const parsed = ComparisonGenerateRequestSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const result = await generatePages(c.env, gate.siteId, gate.scope.orgId, parsed.data);
  return c.json({ ok: true, ...result });
});

cmp.get('/:id/comparisons/pages', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;
  const status = c.req.query('status');
  const pages = await listPages(c.env, gate.siteId, status);
  return c.json({ pages });
});

cmp.post('/:id/comparisons/refresh-pricing', async (c) => {
  const gate = await gateOwnedSite(c);
  if (gate instanceof Response) return gate;

  const body = await c.req.json().catch(() => ({}));
  const parsed = RefreshPricingRequestSchema.safeParse(body ?? {});
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const result = await refreshPricing(c.env, gate.siteId, parsed.data.competitorSlugs);
  return c.json({ ok: true, ...result });
});

export { cmp as comparisonPagesRoutes };
