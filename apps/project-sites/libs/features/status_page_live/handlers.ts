/**
 * @module libs/features/status_page_live/handlers
 * @description Hono routes for the status_page_live feature module.
 *
 * | Method | Path                    | Auth     | Purpose                      |
 * | ------ | ----------------------- | -------- | ---------------------------- |
 * | GET    | /api/status/feed        | public   | Public platform status feed  |
 * | POST   | /api/status/incident    | required | Create a new incident        |
 *
 * Every route 404s when the `status_page_live` flag is off (never 403 — do not
 * leak feature existence) per feature-flags doctrine.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, getStatusFeed, createIncident } from './service.js';
import { CreateIncidentBodySchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const statusPageLive = new Hono<AppContext>();

const unauthorized = (c: Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
const badRequest = (c: Context<AppContext>, details: unknown) =>
  c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details } }, 400);

async function flagOn(c: Context<AppContext>): Promise<boolean> {
  return isFlagOn(c.env, FLAG_KEY, {});
}

/** GET /api/status/feed — public platform health status. */
statusPageLive.get('/api/status/feed', async (c) => {
  if (!(await flagOn(c))) return notFound(c);
  const { status, incidents } = await getStatusFeed(c.env);
  return c.json({ ok: true, status, incidents });
});

/** POST /api/status/incident — create an incident (auth required). */
statusPageLive.post('/api/status/incident', async (c) => {
  if (!(await flagOn(c))) return notFound(c);
  if (!c.get('userId')) return unauthorized(c);

  const body = await c.req.json().catch(() => null);
  const parsed = CreateIncidentBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const incident = await createIncident(c.env, parsed.data);
  return c.json({ ok: true, incident }, 201);
});
