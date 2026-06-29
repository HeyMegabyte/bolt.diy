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
import { DOMAINS } from '@project-sites/shared';
import type { Env, Variables } from '../../../src/types/env.js';
import { requireOrgFlag, notFound } from '../../../src/lib/feature_guard.js';
import { manifestSecret } from '../../../src/services/site_capability_manifest.js';
import {
  FLAG_KEY,
  getSiteAnalyticsSummary,
  getDailySeries,
  getConversionsBySection,
  getFormAnalytics,
  siteOrgId,
} from './service.js';
import { mintShareToken, verifyShareToken } from './share.js';

/** Share-link default lifetime: 30 days. */
const SHARE_TTL_MS = 30 * 86_400_000;

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

// AN5 follow-on — per-day traffic series from the analytics_daily rollup.
siteAnalytics.get('/api/sites/:siteId/analytics/daily', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;

  const siteId = c.req.param('siteId');
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== g.orgId) return notFound(c); // not found OR not yours → 404

  const daysParam = Number(c.req.query('days'));
  const days = Number.isInteger(daysParam) && daysParam > 0 && daysParam <= 365 ? daysParam : 30;

  const series = await getDailySeries(c.env, siteId, days);
  return c.json(series);
});

// AN27 — section-level conversion attribution ("Services drives 40% of calls").
siteAnalytics.get('/api/sites/:siteId/analytics/sections', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;

  const siteId = c.req.param('siteId');
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== g.orgId) return notFound(c); // not found OR not yours → 404

  const windowParam = Number(c.req.query('windowDays'));
  const windowDays =
    Number.isInteger(windowParam) && windowParam > 0 && windowParam <= 365 ? windowParam : 30;

  const breakdown = await getConversionsBySection(c.env, siteId, windowDays);
  return c.json(breakdown);
});

// AN17 — per-form completion rate + abandonment.
siteAnalytics.get('/api/sites/:siteId/analytics/forms', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;

  const siteId = c.req.param('siteId');
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== g.orgId) return notFound(c); // not found OR not yours → 404

  const windowParam = Number(c.req.query('windowDays'));
  const windowDays =
    Number.isInteger(windowParam) && windowParam > 0 && windowParam <= 365 ? windowParam : 30;

  const forms = await getFormAnalytics(c.env, siteId, windowDays);
  return c.json(forms);
});

// AN48 — mint a public, read-only, time-boxed share link for this site's
// analytics (owner-gated). The token is the capability; see the public route.
siteAnalytics.post('/api/sites/:siteId/analytics/share', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;

  const siteId = c.req.param('siteId');
  const owner = await siteOrgId(c.env, siteId);
  if (!owner || owner !== g.orgId) return notFound(c); // not found OR not yours → 404

  const secret = manifestSecret(c.env);
  if (!secret) {
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Sharing is not configured.' } }, 500);
  }
  const expiresAt = Date.now() + SHARE_TTL_MS;
  const token = await mintShareToken(secret, siteId, expiresAt);
  const url = `https://${DOMAINS.SITES_BASE}/shared/analytics/${token}`;
  return c.json({ token, url, expiresAt });
});

// AN48 — PUBLIC read-only analytics by share token. No session: the HMAC-signed,
// expiring token IS the capability. Gated on the same flag as the owner surface.
siteAnalytics.get('/api/public/analytics/:token', async (c) => {
  const secret = manifestSecret(c.env);
  if (!secret) return notFound(c);
  const grant = await verifyShareToken(secret, c.req.param('token'), Date.now());
  if (!grant) return notFound(c); // bad/expired/tampered token → 404 (never leak)

  // The site must still exist + own an org (deleted site → 404).
  const owner = await siteOrgId(c.env, grant.siteId);
  if (!owner) return notFound(c);

  const summary = await getSiteAnalyticsSummary(c.env, owner, grant.siteId, 30);
  return c.json({ summary, expiresAt: grant.expEpochMs });
});
