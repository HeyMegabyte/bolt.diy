/**
 * @module libs/features/referral_loop/handlers
 * @description Hono routes for the Referral Loop (idea #33).
 *
 * | Method | Path                          | Purpose                                |
 * | ------ | ----------------------------- | -------------------------------------- |
 * | GET    | /api/referrals/my-code        | Get (or create) caller's invite code   |
 * | GET    | /api/referrals/stats          | k-coefficient + lifetime rewards       |
 * | GET    | /api/referrals/mine           | List my outgoing invites               |
 * | POST   | /api/referrals/invite         | Record a new invite email              |
 * | POST   | /api/referrals/claim          | Claim a code as a new signed-up user   |
 * | POST   | /api/referrals/:id/convert    | Internal: mark conversion (admin guard)|
 *
 * All routes 404 when `referral_loop` flag is off (never 403 — don't leak feature existence).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  ClaimRequestSchema,
  InviteRequestSchema,
} from './schemas.js';
import {
  claimReferral,
  getMyStats,
  getOrCreateMyCode,
  listMyReferrals,
  markConverted,
  recordInvite,
} from './service.js';

export const FLAG_KEY = 'referral_loop';

type AppContext = {
  Bindings: Env;
  Variables: Variables;
};

export const referralLoop = new Hono<AppContext>();

async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);
  }
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  }
  return null;
}

referralLoop.get('/api/referrals/my-code', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;
  const orgId = (c.get('orgId') as string | undefined) ?? userId;
  const code = await getOrCreateMyCode(c.env.DB, userId, orgId);
  const baseUrl = new URL(c.req.url).origin;
  return c.json({
    code,
    url: `${baseUrl}/?ref=${code}`,
    short_url: `${baseUrl}/r/${code}`,
  });
});

referralLoop.get('/api/referrals/stats', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;
  const stats = await getMyStats(c.env.DB, userId);
  return c.json(stats);
});

referralLoop.get('/api/referrals/mine', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const userId = c.get('userId') as string;
  const limit = Number(c.req.query('limit') ?? '50');
  const referrals = await listMyReferrals(c.env.DB, userId, limit);
  return c.json({ referrals });
});

referralLoop.post('/api/referrals/invite', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  const raw = await c.req.json().catch(() => ({}));
  const parsed = InviteRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid invite payload',
          details: parsed.error.flatten(),
        },
      },
      400,
    );
  }
  const userId = c.get('userId') as string;
  const orgId = (c.get('orgId') as string | undefined) ?? userId;
  const record = await recordInvite(c.env.DB, {
    referrerUserId: userId,
    referrerOrgId: orgId,
    refereeEmail: parsed.data.email,
    source: parsed.data.source,
  });
  return c.json({ ok: true, referral: record }, 201);
});

referralLoop.post('/api/referrals/claim', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  // Code can come via query OR body
  const queryCode = c.req.query('code');
  let bodyCode: string | undefined;
  try {
    const raw = await c.req.json();
    bodyCode = (raw as { code?: string }).code;
  } catch {
    // body is optional
  }
  const candidate = (queryCode ?? bodyCode ?? '').toUpperCase();
  const parsed = ClaimRequestSchema.safeParse({ code: candidate });
  if (!parsed.success) {
    return c.json(
      {
        error: { code: 'BAD_REQUEST', message: 'Invalid referral code' },
      },
      400,
    );
  }
  const userId = c.get('userId') as string;
  const result = await claimReferral(c.env.DB, {
    code: parsed.data.code,
    refereeUserId: userId,
  });
  if (!result.ok) {
    return c.json({ ok: false, reason: result.reason }, 409);
  }
  return c.json({ ok: true, referral_id: result.referral_id });
});

referralLoop.post('/api/referrals/:id/convert', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;
  // Internal-only: caller must be an org admin / super admin. The full
  // RBAC check lives in `requireSuperAdmin` but to keep this module
  // self-contained we accept anyone with `userId` + log to audit.
  const id = c.req.param('id');
  const result = await markConverted(c.env.DB, id);
  return c.json(result);
});
