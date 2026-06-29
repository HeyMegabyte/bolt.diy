/**
 * @module libs/features/preview_share_card/handlers
 * @description Hono route handler for the #55 preview share-card.
 *
 * | Method | Path                              | Purpose                              |
 * | ------ | -------------------------------- | ------------------------------------ |
 * | GET    | /api/sites/:siteId/share-card    | Owner share messages + links + OG    |
 *
 * 404 when the `preview_share_card` flag is off; 401 unauthenticated; 404 when
 * the site is not owned by the caller org (no existence leak).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { dbQueryOne } from '../../../src/services/db.js';
import { FLAG_KEY, buildShareCardForSite } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

interface ShareCardSiteRow {
  id: string;
  slug: string;
  business_name: string | null;
}

export const previewShareCard = new Hono<AppContext>();

/** GET /api/sites/:siteId/share-card — owner share messages + links + OG params. */
previewShareCard.get('/api/sites/:siteId/share-card', async (c) => {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  const orgId = c.get('orgId');
  if (!(await isFlagOn(c.env, FLAG_KEY, { userId, orgId }))) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  if (!orgId) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'No org context' } }, 400);
  }

  const { siteId } = c.req.param();
  const site = await dbQueryOne<ShareCardSiteRow>(
    c.env.DB,
    `SELECT id, slug, business_name FROM sites
      WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [siteId, orgId],
  );
  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }

  // Canonical public URL: prefer the active primary/custom hostname over the
  // slug subdomain so the shared link is the owner's real branded domain.
  const hostRow = await dbQueryOne<{ hostname: string }>(
    c.env.DB,
    `SELECT hostname FROM hostnames
      WHERE site_id = ? AND status = 'active' AND deleted_at IS NULL
      ORDER BY is_primary DESC, type ASC, created_at ASC LIMIT 1`,
    [siteId],
  );

  const card = buildShareCardForSite({
    slug: site.slug,
    businessName: site.business_name ?? site.slug,
    primaryHostname: hostRow?.hostname ?? null,
  });
  return c.json(card, 200);
});
