/**
 * @module libs/features/upgrade_moments/handlers
 * @description Hono route handlers for the Upgrade Moments feature module.
 *
 * | Method | Path                                       | Purpose                              |
 * | ------ | ------------------------------------------ | ------------------------------------ |
 * | GET    | /api/upgrade-moments                       | List eligible, non-dismissed moments |
 * | GET    | /api/upgrade-moments/:trigger              | One moment for a friction point      |
 * | POST   | /api/upgrade-moments/:trigger/dismiss      | Remember a dismissal (KV)            |
 *
 * Dismissals persist in `CACHE_KV` (no D1 migration) keyed per org+trigger with
 * a 90-day TTL, so a dismissed nudge stays hidden but eventually returns.
 *
 * All routes 404 when the `upgrade_moments` flag is off (never 403 — do not leak
 * feature existence). Unauthenticated callers receive 401 before flag eval.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, getUpgradeMoment, listEligibleMoments } from './service.js';
import {
  UpgradeContextSchema,
  UpgradeTriggerSchema,
  type UpgradeTrigger,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const upgradeMoments = new Hono<AppContext>();

/** Dismissals persist for 90 days, then the moment may resurface. */
const DISMISS_TTL_SECONDS = 60 * 60 * 24 * 90;

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);

const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

const badRequest = (c: import('hono').Context<AppContext>, message: string) =>
  c.json({ error: { code: 'BAD_REQUEST', message } }, 400);

/**
 * Auth + flag guard. Returns a short-circuit Response, or null when both pass.
 */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

/** Parse plan + businessType from the query string into a validated context. */
function readContext(c: import('hono').Context<AppContext>) {
  return UpgradeContextSchema.parse({
    plan: c.req.query('plan') ?? 'free',
    businessType: c.req.query('businessType') || undefined,
  });
}

/** KV key for a per-org dismissal of a given trigger. */
function dismissKvKey(orgId: string, trigger: UpgradeTrigger): string {
  return `upgmoment:dismiss:${orgId}:${trigger}`;
}

/** Best-effort read of whether `trigger` was dismissed by `orgId`. */
async function isDismissed(
  env: Env,
  orgId: string,
  trigger: UpgradeTrigger,
): Promise<boolean> {
  const v = await env.CACHE_KV.get(dismissKvKey(orgId, trigger)).catch(() => null);
  return v !== null;
}

// ---------------------------------------------------------------------------
// GET /api/upgrade-moments  — list eligible, non-dismissed moments
// ---------------------------------------------------------------------------

upgradeMoments.get('/api/upgrade-moments', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  let ctx: ReturnType<typeof readContext>;
  try {
    ctx = readContext(c);
  } catch {
    return badRequest(c, 'Invalid plan or businessType');
  }

  const eligible = listEligibleMoments(ctx);
  const flags = await Promise.all(eligible.map((m) => isDismissed(c.env, orgId, m.trigger)));
  const moments = eligible.filter((_, i) => !flags[i]);

  return c.json({ moments, count: moments.length });
});

// ---------------------------------------------------------------------------
// GET /api/upgrade-moments/:trigger  — single moment
// ---------------------------------------------------------------------------

upgradeMoments.get('/api/upgrade-moments/:trigger', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const parsedTrigger = UpgradeTriggerSchema.safeParse(c.req.param('trigger'));
  if (!parsedTrigger.success) return notFound(c);

  let ctx: ReturnType<typeof readContext>;
  try {
    ctx = readContext(c);
  } catch {
    return badRequest(c, 'Invalid plan or businessType');
  }

  const moment = getUpgradeMoment(parsedTrigger.data, ctx);
  const dismissed = await isDismissed(c.env, orgId, parsedTrigger.data);

  return c.json({ ...moment, dismissed });
});

// ---------------------------------------------------------------------------
// POST /api/upgrade-moments/:trigger/dismiss  — remember a dismissal
// ---------------------------------------------------------------------------

upgradeMoments.post('/api/upgrade-moments/:trigger/dismiss', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const parsedTrigger = UpgradeTriggerSchema.safeParse(c.req.param('trigger'));
  if (!parsedTrigger.success) return notFound(c);

  await c.env.CACHE_KV.put(dismissKvKey(orgId, parsedTrigger.data), '1', {
    expirationTtl: DISMISS_TTL_SECONDS,
  }).catch(() => null);

  return c.json({ trigger: parsedTrigger.data, dismissed: true as const });
});
