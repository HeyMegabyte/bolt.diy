/**
 * @module libs/features/gbp_assist/handlers
 * @description Hono routes for Google Business Profile (GBP) Assist (idea #9).
 *
 * | Method | Path                              | Purpose                          |
 * | ------ | --------------------------------- | -------------------------------- |
 * | GET    | /api/sites/:id/gbp/status         | Detect profile + claim deep-link |
 * | POST   | /api/sites/:id/gbp/content-pack   | Generate SEO GBP content pack    |
 * | GET    | /api/sites/:id/gbp/checklist      | Ordered guided setup checklist   |
 *
 * Every route 404s when the `gbp_assist` flag is off (never 403 — don't leak
 * feature existence) per [[feature-flags]].
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  FLAG_KEY,
  checkGbpStatus,
  generateContentPack,
  getSetupChecklist,
} from './service.js';
import {
  GbpStatusSchema,
  GbpContentPackSchema,
  GbpChecklistResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const gbpAssist = new Hono<AppContext>();

const unauthorized = (c: Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, {
    siteId: c.req.param('id'),
    orgId: c.get('orgId'),
  });
  if (!on) return notFound(c);
  return null;
}

/** GET /api/sites/:id/gbp/status — detect existing GBP + claim/create deep-link. */
gbpAssist.get('/api/sites/:id/gbp/status', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  try {
    const status = await checkGbpStatus(c.env, c.req.param('id'));
    return c.json(GbpStatusSchema.parse(status));
  } catch (err) {
    if (err instanceof Error && err.message === 'site_not_found') return notFound(c);
    throw err;
  }
});

/** POST /api/sites/:id/gbp/content-pack — generate an SEO-optimized content pack. */
gbpAssist.post('/api/sites/:id/gbp/content-pack', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  try {
    const pack = await generateContentPack(c.env, c.req.param('id'), c.get('orgId'));
    return c.json(GbpContentPackSchema.parse(pack));
  } catch (err) {
    if (err instanceof Error && err.message === 'site_not_found') return notFound(c);
    throw err;
  }
});

/** GET /api/sites/:id/gbp/checklist — ordered guided setup steps + done-state. */
gbpAssist.get('/api/sites/:id/gbp/checklist', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const checklist = await getSetupChecklist(c.env, c.req.param('id'));
  return c.json(GbpChecklistResponseSchema.parse(checklist));
});
