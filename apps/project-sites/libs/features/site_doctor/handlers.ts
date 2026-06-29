/**
 * @module libs/features/site_doctor/handlers
 * @description Hono route handler for the Site Doctor owner health report.
 *
 * | Method | Path                          | Purpose                                  |
 * | ------ | ----------------------------- | ---------------------------------------- |
 * | GET    | /api/sites/:siteId/doctor     | Owner-facing A–F report + prioritized fix list |
 *
 * Reuses the production-readiness module's ownership check + signal computation
 * (no duplicate scoring), then translates the signals into an owner-facing,
 * plan-locked report. 404 when the `site_doctor` flag is off; 401 unauthenticated;
 * 404 when the site is not owned by the caller org (no existence leak).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { fetchOwnedSite, computeReadiness } from '../prod_readiness_score/service.js';
import { FLAG_KEY, buildSiteDoctorReport } from './service.js';
import { PlanTierSchema, type PlanTier } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const siteDoctor = new Hono<AppContext>();

/** GET /api/sites/:siteId/doctor — owner-facing health report. */
siteDoctor.get('/api/sites/:siteId/doctor', async (c) => {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  // ── Flag gate ─────────────────────────────────────────────────────────────
  const orgId = c.get('orgId');
  if (!(await isFlagOn(c.env, FLAG_KEY, { userId, orgId }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  if (!orgId) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'No org context' } }, 400);
  }

  // ── Ownership ─────────────────────────────────────────────────────────────
  const { siteId } = c.req.param();
  const site = await fetchOwnedSite(c.env, siteId, orgId);
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  // ── Plan (drives the free/paid issue lock) ─────────────────────────────────
  const planParsed = PlanTierSchema.safeParse(c.req.query('plan') ?? 'free');
  const plan: PlanTier = planParsed.success ? planParsed.data : 'free';

  // ── Compute readiness signals → owner-facing report ────────────────────────
  const readiness = await computeReadiness(c.env, site);
  const report = buildSiteDoctorReport(readiness.checks, plan);

  return c.json(report, 200);
});
