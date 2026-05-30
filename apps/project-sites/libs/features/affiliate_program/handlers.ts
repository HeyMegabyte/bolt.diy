/**
 * @module libs/features/affiliate_program/handlers
 * @description Hono routes for the Affiliate Program (idea #32).
 *
 * | Method | Path                   | Purpose                                      |
 * | ------ | ---------------------- | -------------------------------------------- |
 * | POST   | /api/affiliate/enroll  | Enroll the caller as an affiliate partner    |
 * | GET    | /api/affiliate/me      | Dashboard: clicks, conversions, commission   |
 * | GET    | /r/:code               | Attribution redirect — set cookie → 302 home |
 * | POST   | /api/affiliate/payout  | Request a Stripe Connect Express payout      |
 *
 * Auth'd routes 404 when the `affiliate_program` flag is off (never 403 — don't
 * leak feature existence) per [[feature-flags]]. The public `/r/:code` redirect
 * is intentionally flag-gated to 404 too so disabled links die cleanly.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { dbQueryOne } from '../../../src/services/db.js';
import {
  ATTRIBUTION_COOKIE,
  ATTRIBUTION_COOKIE_MAX_AGE,
  EnrollRequestSchema,
  PayoutRequestSchema,
} from './schemas.js';
import {
  createAffiliate,
  getDashboard,
  requestPayout,
  resolveAffiliateByCode,
  resolveAffiliateByEmail,
  trackReferralClick,
  FLAG_KEY,
} from './service.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const affiliateProgram = new Hono<AppContext>();

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

/** Resolve the authenticated user's email (used as the affiliate owner key). */
async function callerEmail(c: import('hono').Context<AppContext>): Promise<string | null> {
  const userId = c.get('userId');
  if (!userId) return null;
  const row = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ? LIMIT 1',
    [userId],
  ).catch(() => null);
  return row?.email ?? null;
}

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

/** Enroll the caller as an affiliate (idempotent per email). */
affiliateProgram.post('/api/affiliate/enroll', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const raw = await c.req.json().catch(() => ({}));
  const parsed = EnrollRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid enroll payload',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }
  const userId = c.get('userId') as string;
  const affiliate = await createAffiliate(c.env.DB, {
    email: parsed.data.email,
    ownerUserId: userId,
    stripeConnectId: parsed.data.stripeConnectId,
  });
  const baseUrl = new URL(c.req.url).origin;
  return c.json(
    { ok: true, code: affiliate.code, share_url: `${baseUrl}/r/${affiliate.code}` },
    201,
  );
});

/** Affiliate dashboard for the caller. */
affiliateProgram.get('/api/affiliate/me', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const email = await callerEmail(c);
  if (!email) return notFound(c);
  const affiliate = await resolveAffiliateByEmail(c.env.DB, email);
  if (!affiliate) return c.json({ ok: false, enrolled: false }, 200);

  const baseUrl = new URL(c.req.url).origin;
  const dashboard = await getDashboard(c.env.DB, affiliate, baseUrl);
  return c.json(dashboard);
});

/**
 * Public attribution redirect. Sets a 90-day attribution cookie bound to the
 * affiliate code + a per-visitor anon-id, records the click, and 302s to the
 * homepage. 404s when the flag is off or the code is unknown.
 */
affiliateProgram.get('/r/:code', async (c) => {
  const on = await isFlagOn(c.env, FLAG_KEY, {});
  if (!on) return notFound(c);

  const code = (c.req.param('code') ?? '').toUpperCase();
  const affiliate = await resolveAffiliateByCode(c.env.DB, code);
  if (!affiliate || affiliate.status !== 'active') return notFound(c);

  // Reuse an existing anon-id cookie value's suffix or mint a fresh one.
  const visitorAnonId = crypto.randomUUID();
  await trackReferralClick(c.env.DB, { code, visitorAnonId });

  setCookie(c, ATTRIBUTION_COOKIE, `${code}.${visitorAnonId}`, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: ATTRIBUTION_COOKIE_MAX_AGE,
  });

  const baseUrl = new URL(c.req.url).origin;
  return c.redirect(`${baseUrl}/?ref=${code}`, 302);
});

/** Request a Stripe Connect Express payout of all pending commission. */
affiliateProgram.post('/api/affiliate/payout', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const raw = await c.req.json().catch(() => ({}));
  const parsed = PayoutRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid payout payload' } },
      400,
    );
  }

  // Resolve the caller's code (explicit code must belong to the caller).
  const email = await callerEmail(c);
  if (!email) return notFound(c);
  const own = await resolveAffiliateByEmail(c.env.DB, email);
  if (!own) return c.json({ error: { code: 'NOT_FOUND', message: 'Not enrolled' } }, 404);
  if (parsed.data.code && parsed.data.code.toUpperCase() !== own.code) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Code not owned by caller' } }, 403);
  }

  const result = await requestPayout(c.env, c.env.DB, own.code);
  if (!result.ok) return c.json({ ok: false, reason: result.reason }, 409);
  return c.json({ ok: true, amount_usd: result.amountUsd, transfer_id: result.transfer_id });
});
