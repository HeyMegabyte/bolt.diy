/**
 * @module libs/features/prod_readiness_score/handlers
 * @description Hono sub-application for the Production Readiness Score feature.
 *
 * @remarks Mount in src/index.ts as:
 *   ```ts
 *   import { prodReadinessScore } from '../libs/features/prod_readiness_score/handlers.js';
 *   app.route('/', prodReadinessScore);
 *   ```
 *
 * Routes exposed:
 *   GET /api/sites/:siteId/readiness
 *     Auth: orgId from c.get('orgId') — 401 if missing
 *     Flag: prod_readiness_score — 404 if off
 *     Returns: { score, grade, checks[] }
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { fetchOwnedSite, computeReadiness } from './service.js';

const FLAG_KEY = 'prod_readiness_score';

type AppContext = { Bindings: Env; Variables: Variables };

export const prodReadinessScore = new Hono<AppContext>();

/** GET /api/sites/:siteId/readiness — production readiness score for a site. */
prodReadinessScore.get('/api/sites/:siteId/readiness', async (c) => {
  // ── Feature flag gate ────────────────────────────────────────────────────
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) {
    return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);
  }

  // ── Ownership check ──────────────────────────────────────────────────────
  const { siteId } = c.req.param();
  const site = await fetchOwnedSite(c.env, siteId, orgId);
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  }

  // ── Compute + respond ────────────────────────────────────────────────────
  const result = await computeReadiness(c.env, site);
  return c.json(result, 200);
});
