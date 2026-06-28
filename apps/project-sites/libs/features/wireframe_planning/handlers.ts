/**
 * @module libs/features/wireframe_planning/handlers
 * @description Hono routes for the wireframe_planning feature (flag: `wireframe_planning`).
 *
 * | Method | Path                   | Auth     | Purpose                           |
 * | ------ | ---------------------- | -------- | --------------------------------- |
 * | POST   | /api/wireframe/plan    | required | Create a wireframe plan for a site|
 * | GET    | /api/wireframe/:siteId | required | Fetch the latest plan for a site  |
 *
 * Every route 404s when the `wireframe_planning` flag is off (never 403 — do
 * not leak feature existence) per [[feature-flags]].
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { assertSiteOwned } from '../../../src/services/site_ownership.js';
import { WireframePlanCreateSchema } from './schemas.js';
import { FLAG_KEY, buildWireframePlan, getWireframePlan } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const wireframePlanning = new Hono<AppContext>();

const unauthorized = (c: Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

const badRequest = (c: Context<AppContext>, details: unknown) =>
  c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details } }, 400);

/** Flag gate — 404 when off so the feature existence is not leaked. */
async function flagOn(c: Context<AppContext>): Promise<boolean> {
  return isFlagOn(c.env, FLAG_KEY, {});
}

/**
 * POST /api/wireframe/plan
 *
 * Accepts `{ siteId, prompt }` and returns the generated wireframe plan.
 * Requires auth.  Flag-off → 404.
 */
wireframePlanning.post('/api/wireframe/plan', async (c) => {
  if (!(await flagOn(c))) return notFound(c);
  if (!c.get('userId')) return unauthorized(c);

  const body = await c.req.json().catch(() => null);
  const parsed = WireframePlanCreateSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error.flatten());
  if (!(await assertSiteOwned(c.env, c.get('orgId'), parsed.data.siteId))) return notFound(c);

  const plan = await buildWireframePlan(c.env, parsed.data.siteId, parsed.data.prompt);
  return c.json({ ok: true, plan }, 201);
});

/**
 * GET /api/wireframe/:siteId
 *
 * Returns the most-recent wireframe plan for the given site, or `null` when
 * none exists.  Requires auth.  Flag-off → 404.
 */
wireframePlanning.get('/api/wireframe/:siteId', async (c) => {
  if (!(await flagOn(c))) return notFound(c);
  if (!c.get('userId')) return unauthorized(c);

  const { siteId } = c.req.param();
  if (!(await assertSiteOwned(c.env, c.get('orgId'), siteId))) return notFound(c);
  const plan = await getWireframePlan(c.env, siteId);
  return c.json({ ok: true, plan });
});
