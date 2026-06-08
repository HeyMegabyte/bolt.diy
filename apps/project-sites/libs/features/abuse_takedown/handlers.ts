/**
 * @module libs/features/abuse_takedown/handlers
 * @description Hono routes for the abuse / takedown workflow (flag: `abuse_takedown`).
 *
 * | Method | Path                                | Auth        | Purpose                         |
 * | ------ | ----------------------------------- | ----------- | ------------------------------- |
 * | POST   | /api/abuse/report                   | public      | Report a published site         |
 * | GET    | /api/abuse/reports                  | super-admin | List reports for review         |
 * | POST   | /api/abuse/reports/:id/resolve      | super-admin | Dismiss or uphold a takedown    |
 *
 * Every route 404s when the `abuse_takedown` flag is off (never 403 — don't leak
 * feature existence) per [[feature-flags]]. The public report route is
 * rate-limited; resolution is restricted to platform super-admins.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { rateLimitMiddleware } from '../../../src/middleware/rate_limit.js';
import { dbQueryOne } from '../../../src/services/db.js';
import {
  FLAG_KEY,
  resolveReportedSite,
  createAbuseReport,
  listAbuseReports,
  resolveAbuseReport,
} from './service.js';
import { AbuseReportSubmitSchema, AbuseReportResolveSchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const abuseTakedown = new Hono<AppContext>();

const unauthorized = (c: Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
const forbidden = (c: Context<AppContext>) =>
  c.json({ error: { code: 'FORBIDDEN', message: 'Super-admin access required' } }, 403);
const notFound = (c: Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
const badRequest = (c: Context<AppContext>, details: unknown) =>
  c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details } }, 400);

/** Flag gate (global scope) — 404 when off so the feature's existence isn't leaked. */
async function flagOn(c: Context<AppContext>): Promise<boolean> {
  return isFlagOn(c.env, FLAG_KEY, {});
}

/** Resolve true only for an authenticated platform super-admin. */
async function isSuperAdmin(c: Context<AppContext>): Promise<boolean> {
  const userId = c.get('userId');
  if (!userId) return false;
  const row = await dbQueryOne<{ is_super_admin: number }>(
    c.env.DB,
    'SELECT is_super_admin FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId],
  );
  return !!row && row.is_super_admin === 1;
}

/** POST /api/abuse/report — public abuse intake against a published site. */
abuseTakedown.post(
  '/api/abuse/report',
  rateLimitMiddleware({ maxRequests: 20, windowSeconds: 60, prefix: 'rl:abuse' }),
  async (c) => {
    if (!(await flagOn(c))) return notFound(c);
    const body = await c.req.json().catch(() => null);
    const parsed = AbuseReportSubmitSchema.safeParse(body);
    if (!parsed.success) return badRequest(c, parsed.error.flatten());

    const site = await resolveReportedSite(c.env, parsed.data.site);
    if (!site) return notFound(c);

    const { id } = await createAbuseReport(c.env, parsed.data, site);
    return c.json({ ok: true, id, status: 'pending' }, 202);
  },
);

/** GET /api/abuse/reports — operator review queue (super-admin only). */
abuseTakedown.get('/api/abuse/reports', async (c) => {
  if (!(await flagOn(c))) return notFound(c);
  if (!c.get('userId')) return unauthorized(c);
  if (!(await isSuperAdmin(c))) return forbidden(c);
  const status = c.req.query('status') || undefined;
  const reports = await listAbuseReports(c.env, status);
  return c.json({ reports });
});

/** POST /api/abuse/reports/:id/resolve — dismiss or uphold a takedown (super-admin). */
abuseTakedown.post('/api/abuse/reports/:id/resolve', async (c) => {
  if (!(await flagOn(c))) return notFound(c);
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  if (!(await isSuperAdmin(c))) return forbidden(c);

  const body = await c.req.json().catch(() => null);
  const parsed = AbuseReportResolveSchema.safeParse(body);
  if (!parsed.success) return badRequest(c, parsed.error.flatten());

  const resolved = await resolveAbuseReport(
    c.env,
    c.req.param('id'),
    parsed.data.action,
    parsed.data.note,
    userId,
  );
  if (!resolved) return notFound(c);
  return c.json({ ok: true, report: resolved });
});
