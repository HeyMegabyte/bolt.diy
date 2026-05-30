/**
 * @module libs/features/token_burn_meter/handlers
 * @description Hono routes for the Token-Burn Meter feature module (idea #13).
 *
 * | Method | Path                      | Purpose                                  |
 * | ------ | ------------------------- | ---------------------------------------- |
 * | GET    | /api/usage/budget         | Current caller-org budget meter          |
 * | GET    | /api/admin/usage/budget   | All-orgs budget meters (platform admin)  |
 *
 * Both routes 404 when the `token_burn_meter` flag is off (never 403 — don't
 * leak feature existence) per [[feature-flags]]. The admin route additionally
 * requires the platform-owner email; non-admins also get 404, never 403.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { dbQueryOne } from '../../../src/services/db.js';
import { FLAG_KEY, getOrgMeter, getAllOrgMeters } from './service.js';
import {
  OrgBudgetResponseSchema,
  AdminBudgetResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const tokenBurnMeter = new Hono<AppContext>();

/** Platform-owner email allowed to view the all-orgs admin meter. */
const PLATFORM_ADMIN_EMAIL = 'brian@megabyte.space';

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

/** Whether the authenticated user is the platform owner. */
async function isPlatformAdmin(c: import('hono').Context<AppContext>): Promise<boolean> {
  const userId = c.get('userId');
  if (!userId) return false;
  const row = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ? LIMIT 1',
    [userId],
  ).catch(() => null);
  return row?.email === PLATFORM_ADMIN_EMAIL;
}

/** Current caller-org budget meter. */
tokenBurnMeter.get('/api/usage/budget', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'BAD_REQUEST', message: 'No org context' } }, 400);

  const snapshot = await getOrgMeter(c.env, orgId);
  return c.json(OrgBudgetResponseSchema.parse(snapshot));
});

/** All-orgs budget meters — platform admin only (404 for everyone else). */
tokenBurnMeter.get('/api/admin/usage/budget', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  if (!(await isPlatformAdmin(c))) return notFound(c);

  const orgs = await getAllOrgMeters(c.env);
  return c.json(AdminBudgetResponseSchema.parse({ count: orgs.length, orgs }));
});
