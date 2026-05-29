/**
 * @module routes/comparison_pages
 * @description Comparison Pages Engine routes (feature #31).
 *
 * Mounted at `/api/sites/:id/comparisons/*`. Flag-gated on `comparison_pages`.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  ComparisonGenerateRequestSchema,
  CompetitorSeedRequestSchema,
  RefreshPricingRequestSchema,
} from '../../libs/features/comparison_pages/feature.schemas.js';
import {
  generatePages,
  listCompetitors,
  listPages,
  refreshPricing,
  seedCompetitors,
} from '../services/comparison_pages.js';
import { dbQueryOne } from '../services/db.js';

const cmp = new Hono<{ Bindings: Env; Variables: Variables }>();

async function guard(env: Env): Promise<boolean> {
  return isFlagOn(env, 'comparison_pages');
}

cmp.get('/:id/comparisons/competitors', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const competitors = await listCompetitors(c.env, c.req.param('id'));
  return c.json({ competitors });
});

cmp.post('/:id/comparisons/competitors', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

  const siteId = c.req.param('id');
  const orgId = c.get('orgId') ?? '';
  const site = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = CompetitorSeedRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.issues } },
      400,
    );
  }
  const result = await seedCompetitors(c.env, siteId, orgId, parsed.data.competitors);
  return c.json({ ok: true, ...result });
});

cmp.post('/:id/comparisons/generate', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

  const orgId = c.get('orgId') ?? '';
  const body = await c.req.json().catch(() => null);
  const parsed = ComparisonGenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.issues } },
      400,
    );
  }
  const result = await generatePages(c.env, c.req.param('id'), orgId, parsed.data);
  return c.json({ ok: true, ...result });
});

cmp.get('/:id/comparisons/pages', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const status = c.req.query('status');
  const pages = await listPages(c.env, c.req.param('id'), status);
  return c.json({ pages });
});

cmp.post('/:id/comparisons/refresh-pricing', async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  if (!(await guard(c.env))) return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  const body = await c.req.json().catch(() => ({}));
  const parsed = RefreshPricingRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.issues } },
      400,
    );
  }
  const result = await refreshPricing(c.env, c.req.param('id'), parsed.data.competitorSlugs);
  return c.json({ ok: true, ...result });
});

export { cmp as comparisonPagesRoutes };
