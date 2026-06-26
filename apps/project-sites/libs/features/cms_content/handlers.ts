/**
 * @module libs/features/cms_content/handlers
 * @description Hono sub-application for the CMS content bridge.
 *
 * @remarks Mount in src/index.ts as:
 *   ```ts
 *   import { cmsContent } from '../libs/features/cms_content/handlers.js';
 *   app.route('/', cmsContent);
 *   ```
 *
 * Routes exposed:
 *   GET  /api/cms/blog.json        Public (flag-gated). Edge-cached proxy of the
 *                                  Payload blog feed for generated sites.
 *   POST /api/cms/revalidate       Payload `notify-sites` receiver. HMAC-verified;
 *                                  purges the cached feed on publish/unpublish/delete.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { CmsWebhookPayload } from './schemas.js';
import { fetchBlogFeed, purgeBlogCache, verifySignature } from './service.js';

const FLAG_KEY = 'cms_content';

type AppContext = { Bindings: Env; Variables: Variables };

export const cmsContent = new Hono<AppContext>();

/** GET /api/cms/blog.json — cached, CORS-open feed for generated sites. */
cmsContent.get('/api/cms/blog.json', async (c) => {
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) {
    return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  }

  const limit = Number(c.req.query('limit')) || 50;
  const feed = await fetchBlogFeed(c.env, limit);

  return c.json(feed, 200, {
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    'Access-Control-Allow-Origin': '*',
  });
});

/** POST /api/cms/revalidate — Payload publish webhook receiver (HMAC-gated). */
cmsContent.post('/api/cms/revalidate', async (c) => {
  if (!(await isFlagOn(c.env, FLAG_KEY, {}))) {
    return c.json({ error: { code: 'NOT_FOUND' } }, 404);
  }

  const secret = c.env.SITES_REVALIDATE_SECRET;
  if (!secret) {
    // Dark-safe: receiver shipped ahead of the secret. Tell the caller, don't 500.
    return c.json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'revalidation not configured' } }, 503);
  }

  const raw = await c.req.text();
  const sig = c.req.header('x-ps-signature') ?? '';
  if (!(await verifySignature(secret, raw, sig))) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'invalid signature' } }, 401);
  }

  const parsed = CmsWebhookPayload.safeParse((() => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  })());
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'malformed payload' } }, 400);
  }

  await purgeBlogCache(c.env);

  return c.json({ ok: true, collection: parsed.data.collection, slug: parsed.data.slug, purged: true }, 200);
});
