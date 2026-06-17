/**
 * @module libs/features/site_thumbnail_grid/handlers
 * @description Hono routes for the site_thumbnail_grid feature module.
 *
 * | Method | Path                          | Auth     | Purpose                            |
 * | ------ | ----------------------------- | -------- | ---------------------------------- |
 * | GET    | /api/sites/:siteId/thumbnail  | required | Get or generate a site thumbnail   |
 *
 * Every route 404s when the `site_thumbnail_grid` flag is off (never 403) per
 * feature-flags doctrine.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, captureThumbnail } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const siteThumbnailGrid = new Hono<AppContext>();

const unauthorized = (c: Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

async function flagOn(c: Context<AppContext>): Promise<boolean> {
  const userId = c.get('userId');
  return isFlagOn(c.env, FLAG_KEY, { userId });
}

/** GET /api/sites/:siteId/thumbnail — get or generate a thumbnail. */
siteThumbnailGrid.get('/api/sites/:siteId/thumbnail', async (c) => {
  if (!(await flagOn(c))) return notFound(c);
  if (!c.get('userId')) return unauthorized(c);

  const siteId = c.req.param('siteId');
  const { thumbnailUrl, generated } = await captureThumbnail(c.env, siteId);
  return c.json({ ok: true, thumbnailUrl, generated });
});
