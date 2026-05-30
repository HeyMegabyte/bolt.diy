/**
 * @module libs/features/search_submit/handlers
 * @description Hono routes for the Search/AI-Engine Auto-Submit feature (idea #3).
 *
 * | Method | Path                          | Flag-gated | Purpose                                  |
 * | ------ | ----------------------------- | ---------- | ---------------------------------------- |
 * | POST   | /api/sites/:id/search-submit  | yes (404)  | Manual re-submit of a site to engines    |
 * | GET    | /:key.txt                     | NO         | IndexNow ownership verification key file |
 *
 * The POST route 404s when `search_engine_submit` is off (never 403 — don't
 * leak feature existence) per [[feature-flags]].
 *
 * The GET `/{key}.txt` route is intentionally **public, not flag-gated**:
 * IndexNow fetches it to verify host ownership before accepting submissions, so
 * it must resolve even while the feature is dark for the dashboard. Per the
 * IndexNow spec the file body is simply the key string itself.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { dbQueryOne } from '../../../src/services/db.js';
import { FLAG_KEY, submitSite, deriveIndexNowKey, siteHost, buildSitemapUrls } from './service.js';
import { SubmitSiteResponseSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const searchSubmit = new Hono<AppContext>();

const unauthorized = (c: Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

/** A 32-char lowercase-hex IndexNow key path: `/{key}.txt`. */
const KEY_PATH_RE = /^[a-f0-9]{32}\.txt$/;

/**
 * IndexNow ownership verification — PUBLIC, never flag-gated.
 *
 * Per the IndexNow spec the key file's body is exactly the key string. We only
 * serve well-formed key paths (32 hex chars + `.txt`); anything else 404s so
 * this catch-all never shadows other `*.txt` assets.
 */
searchSubmit.get('/:keyfile{[a-f0-9]+\\.txt}', (c) => {
  const keyfile = c.req.param('keyfile');
  if (!KEY_PATH_RE.test(keyfile)) return notFound(c);
  const key = keyfile.replace(/\.txt$/, '');
  return c.body(key, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  });
});

/** Manual re-submit of a site to search + AI engines (flag-gated, 404 when off). */
searchSubmit.post('/api/sites/:id/search-submit', async (c) => {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);

  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);

  const siteId = c.req.param('id');
  // Resolve slug + org for the response envelope (and to confirm the site exists).
  const site = await dbQueryOne<{ id: string; slug: string; org_id: string }>(
    c.env.DB,
    'SELECT id, slug, org_id FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [siteId],
  ).catch(() => null);
  if (!site?.slug) return notFound(c);

  const { keyPath } = await deriveIndexNowKey(site.id);
  const results = await submitSite(c.env, site.id);

  return c.json(
    SubmitSiteResponseSchema.parse({
      siteId: site.id,
      host: siteHost(site.slug),
      keyPath,
      sitemapUrls: buildSitemapUrls(site.slug),
      results,
    }),
  );
});
