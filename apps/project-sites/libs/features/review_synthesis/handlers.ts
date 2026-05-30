/**
 * @module libs/features/review_synthesis/handlers
 * @description Hono routes for Verified Review Synthesis.
 *
 * | Method | Path                              | Auth   | Purpose                              |
 * | ------ | --------------------------------- | ------ | ------------------------------------ |
 * | POST   | /api/reviews/:siteId/synthesize   | yes    | (Re)synthesize the site's reviews    |
 * | GET    | /api/reviews/:siteId              | public | Stored synthesis + JSON-LD for widget|
 *
 * Both 404 when the `review_synthesis` flag is off. POST is org-scoped (the site
 * must belong to the caller). GET is public (the synthesis is shown on the
 * published site) and emits AggregateRating JSON-LD only when real reviews back it.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { requireOrgFlag, requireFlag, notFound } from '../../../src/lib/feature_guard.js';
import { dbQuery } from '../../../src/services/db.js';
import { FLAG_KEY, synthesizeReviews, getSynthesis, buildReviewJsonLd } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const reviewSynthesis = new Hono<AppContext>();

interface SiteRow {
  id: string;
  org_id: string;
  business_name: string;
  google_place_id: string | null;
}

async function loadSite(c: { env: Env }, siteId: string): Promise<SiteRow | null> {
  const { data } = await dbQuery<SiteRow>(
    c.env.DB,
    'SELECT id, org_id, business_name, google_place_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  return data[0] ?? null;
}

reviewSynthesis.post('/api/reviews/:siteId/synthesize', async (c) => {
  const g = await requireOrgFlag(c, FLAG_KEY);
  if (g instanceof Response) return g;
  const site = await loadSite(c, c.req.param('siteId'));
  if (!site || site.org_id !== g.orgId) return notFound(c);

  const synthesis = await synthesizeReviews(c.env, {
    siteId: site.id,
    orgId: g.orgId,
    businessName: site.business_name,
    placeId: site.google_place_id,
  });
  return c.json(synthesis);
});

reviewSynthesis.get('/api/reviews/:siteId', async (c) => {
  // Public read for the published-site widget — flag-gated, no auth.
  const gate = await requireFlag(c, FLAG_KEY);
  if (gate !== true) return gate;
  const siteId = c.req.param('siteId');
  const synthesis = await getSynthesis(c.env, siteId);
  if (!synthesis) return notFound(c);
  const site = await loadSite(c, siteId);
  const jsonLd = buildReviewJsonLd(
    site?.business_name ?? 'Business',
    synthesis.featured,
    synthesis.aggregate,
  );
  return c.json({ synthesis, jsonLd });
});
