/**
 * @module libs/features/aeo_pass/handlers
 * @description Hono route handlers for the AEO Pass feature module.
 *
 * Routes (both require auth + feature flag):
 *  POST /api/aeo/audit/:siteId  — run an AEO audit and return the result
 *  GET  /api/aeo/:siteId        — fetch the latest audit for a site
 *
 * @remarks Flag-off returns 404 (never 403) to avoid leaking feature
 * existence. Auth failure returns 401. Validation failure returns 400.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, runAeoAudit, getLatestAeoAudit } from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const aeoPass = new Hono<AppContext>();

// ─── helpers ──────────────────────────────────────────────────────────────────

const unauthorized = (c: Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

const badRequest = (c: Context<AppContext>, message: string) =>
  c.json({ error: { code: 'BAD_REQUEST', message } }, 400);

async function flagOn(c: Context<AppContext>): Promise<boolean> {
  return isFlagOn(c.env, FLAG_KEY, {});
}

// ─── routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/aeo/audit/:siteId
 *
 * Run an AEO audit for the given site and return the result.
 * Requires authentication and the `aeo_pass` feature flag to be enabled.
 */
aeoPass.post('/api/aeo/audit/:siteId', async (c) => {
  if (!(await flagOn(c))) return notFound(c);

  const userId = c.get('userId');
  if (!userId) return unauthorized(c);

  const siteId = c.req.param('siteId');
  if (!siteId || siteId.trim() === '') return badRequest(c, 'siteId is required');

  const audit = await runAeoAudit(c.env, siteId);
  return c.json({ ok: true, audit }, 200);
});

/**
 * GET /api/aeo/:siteId
 *
 * Fetch the most recent AEO audit for the given site.
 * Returns `{ ok: true, audit: null }` when no audit has been run yet.
 * Requires authentication and the `aeo_pass` feature flag to be enabled.
 */
aeoPass.get('/api/aeo/:siteId', async (c) => {
  if (!(await flagOn(c))) return notFound(c);

  const userId = c.get('userId');
  if (!userId) return unauthorized(c);

  const siteId = c.req.param('siteId');
  if (!siteId || siteId.trim() === '') return badRequest(c, 'siteId is required');

  const audit = await getLatestAeoAudit(c.env, siteId);
  return c.json({ ok: true, audit }, 200);
});
