/**
 * @module libs/features/referral_loop/handlers
 * @description Hono route handlers for the Referral Loop feature module.
 *
 * | Method | Path                    | Purpose                                  |
 * | ------ | ----------------------- | ---------------------------------------- |
 * | GET    | /api/referral/code      | Get or create the caller-org referral code |
 * | POST   | /api/referral/track     | Record a referral click / visit          |
 * | GET    | /api/referral/stats     | Caller-org referral stats summary        |
 *
 * All routes 404 when the `referral_loop` flag is off (never 403 — do not
 * leak feature existence) per [[feature-flags]].
 * Unauthenticated callers receive 401 before flag evaluation.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { unauthorized, notFound } from '../../../src/lib/feature_guard.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, getOrCreateReferralCode, trackReferral, getReferralStats } from './service.js';
import { TrackReferralBodySchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const referralLoop = new Hono<AppContext>();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const badRequest = (c: import('hono').Context<AppContext>, message: string) =>
  c.json({ error: { code: 'BAD_REQUEST', message } }, 400);

/**
 * Auth + flag guard.
 *
 * Returns a Response to short-circuit when the caller is unauthenticated or
 * the feature flag is off. Returns null when both checks pass.
 */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/referral/code
// ---------------------------------------------------------------------------

/**
 * Return the caller-org referral code, creating one on first call.
 *
 * @remarks
 * Requires an authenticated session (userId + orgId set by auth middleware).
 * Returns 404 when the `referral_loop` flag is off.
 *
 * @example
 * ```sh
 * curl -H "Authorization: Bearer <token>" https://projectsites.dev/api/referral/code
 * # {"code":"AB12CD34","referral_url":"https://...","clicks":0,"conversions":0}
 * ```
 */
referralLoop.get('/api/referral/code', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const result = await getOrCreateReferralCode(c.env, orgId);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /api/referral/track
// ---------------------------------------------------------------------------

/**
 * Record a referral click — called when a visitor lands via a referral URL.
 *
 * @remarks
 * This endpoint is intentionally callable by unauthenticated visitors (the
 * flag guard still applies, but userId is optional for tracking purposes).
 * To keep the guard consistent with the module contract, 401 is skipped for
 * this route — only the flag is checked.
 *
 * @example
 * ```sh
 * curl -X POST https://projectsites.dev/api/referral/track \
 *   -H "Content-Type: application/json" \
 *   -d '{"code":"AB12CD34"}'
 * # {"attribution_id":"...","status":"click"}
 * ```
 */
referralLoop.post('/api/referral/track', async (c) => {
  // Flag-only guard for this public-facing endpoint.
  const on = await isFlagOn(c.env, FLAG_KEY, {
    userId: c.get('userId') ?? '',
    orgId: c.get('orgId'),
  });
  if (!on) return notFound(c);

  const rawBody = await c.req.json().catch(() => null);
  const parsed = TrackReferralBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return badRequest(c, 'Invalid request body: code is required');
  }

  try {
    const result = await trackReferral(c.env, parsed.data);
    return c.json(result, 201);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 404) return notFound(c);
    throw err;
  }
});

// ---------------------------------------------------------------------------
// GET /api/referral/stats
// ---------------------------------------------------------------------------

/**
 * Return referral stats for the authenticated caller-org.
 *
 * @example
 * ```sh
 * curl -H "Authorization: Bearer <token>" https://projectsites.dev/api/referral/stats
 * # {"code":"AB12CD34","clicks":42,"conversions":3,"pending":39}
 * ```
 */
referralLoop.get('/api/referral/stats', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return badRequest(c, 'No org context');

  const stats = await getReferralStats(c.env, orgId);
  return c.json(stats);
});
