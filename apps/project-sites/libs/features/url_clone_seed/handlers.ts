/**
 * @module libs/features/url_clone_seed/handlers
 * @description Hono routes for the URL Clone Seed feature module.
 *
 * | Method | Path              | Purpose                                      |
 * | ------ | ----------------- | -------------------------------------------- |
 * | POST   | /api/clone/seed   | Extract content from a URL and seed a site   |
 *
 * The route returns 404 when the `url_clone_seed` flag is off (never 403
 * — do not leak feature existence) per [[feature-flags]].
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, cloneFromUrl } from './service.js';
import { CloneSeedBodySchema, CloneSeedResponseSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const urlCloneSeedRouter = new Hono<AppContext>();

const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

/**
 * POST /api/clone/seed
 *
 * Extracts content from the supplied URL via Cloudflare Browser Rendering and
 * returns the extracted title, description, and text length.
 *
 * @remarks
 * The handler does NOT persist content to D1 — it returns the extraction result
 * for the caller to use.  Actual site seeding (DB writes) is handled by the
 * calling client once it has reviewed the extracted data.
 */
urlCloneSeedRouter.post('/api/clone/seed', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const body = await c.req.json().catch(() => null);
  const parsed = CloneSeedBodySchema.safeParse(body);

  if (!parsed.success) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: parsed.error.issues,
        },
      },
      422,
    );
  }

  const { url } = parsed.data;

  const content = await cloneFromUrl(c.env, url);

  if (!content) {
    return c.json(
      {
        ok: false,
        error: {
          code: 'EXTRACTION_FAILED',
          message: 'Could not extract content from the provided URL. The site may be blocking automated access.',
        },
      },
      502,
    );
  }

  return c.json(
    CloneSeedResponseSchema.parse({
      ok: true,
      data: {
        title: content.title,
        description: content.description,
        textLength: content.textContent.length,
        extractedAt: new Date().toISOString(),
      },
    }),
    200,
  );
});
