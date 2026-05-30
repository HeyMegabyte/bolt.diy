/**
 * @module libs/features/site_analytics/handlers
 * @description Hono route for Site Analytics.
 *
 * | Method | Path                          | Purpose                          |
 * | ------ | ----------------------------- | -------------------------------- |
 * | GET    | /api/sites/:siteId/analytics  | Owner analytics summary for site |
 *
 * 404 when the `site_analytics` flag is off (never 403). Org-ownership is
 * enforced: a caller can only read analytics for a site their org owns —
 * a mismatch returns 404 (never leak another org's site existence).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { requireOrgFlag, notFound } from '../../../src/lib/feature_guard.js';
import { FLAG_KEY, getSiteAnalyticsSummary, siteOrgId } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const siteAnalytics = new Hono<AppContext>();

siteAnalytics.get('/api/sites/:siteId/analytics', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;

  const siteId = c.req.param('siteId');
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== g.orgId) return notFound(c); // not found OR not yours → 404

  const windowParam = Number(c.req.query('windowDays'));
  const windowDays =
    Number.isInteger(windowParam) && windowParam > 0 && windowParam <= 365 ? windowParam : 30;

  const summary = await getSiteAnalyticsSummary(c.env, g.orgId, siteId, windowDays);
  return c.json(summary);
});
