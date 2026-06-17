/**
 * @module libs/features/credit_wallet_rollover/handlers
 * @description Hono route handlers for the Credit Wallet Rollover feature module.
 *
 * Routes:
 *   GET  /api/credits/balance  — Current balance + plan metadata for the org.
 *   POST /api/credits/apply    — Deduct credits; idempotent via optional key.
 *   GET  /api/credits/history  — Ledger history, newest first.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import {
  FLAG_KEY,
  getBalance,
  applyCredits,
  getCreditHistory,
  resolveMonthlyAllowance,
  ROLLOVER_CAP_MULTIPLIER,
} from './service.js';
import { ApplyCreditsBodySchema } from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const creditWalletRollover = new Hono<AppContext>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

async function guard(
  c: import('hono').Context<AppContext>,
): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

// ---------------------------------------------------------------------------
// GET /api/credits/balance
// ---------------------------------------------------------------------------

creditWalletRollover.get('/api/credits/balance', async (c) => {
  const early = await guard(c);
  if (early) return early;

  const orgId = c.get('orgId');
  if (!orgId) return unauthorized(c);

  const [balance, monthlyAllowance] = await Promise.all([
    getBalance(c.env.DB, orgId),
    resolveMonthlyAllowance(c.env.DB, orgId),
  ]);

  return c.json({
    org_id: orgId,
    balance,
    monthly_allowance: monthlyAllowance,
    rollover_cap: monthlyAllowance * ROLLOVER_CAP_MULTIPLIER,
  });
});

// ---------------------------------------------------------------------------
// POST /api/credits/apply
// ---------------------------------------------------------------------------

creditWalletRollover.post('/api/credits/apply', async (c) => {
  const early = await guard(c);
  if (early) return early;

  const orgId = c.get('orgId');
  if (!orgId) return unauthorized(c);

  const body = await c.req.json().catch(() => null);
  const parsed = ApplyCreditsBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.flatten() } },
      422,
    );
  }

  const { amount, description, idempotency_key } = parsed.data;

  const result = await applyCredits(c.env, orgId, amount, description, idempotency_key);

  return c.json({
    applied: result.applied,
    balance: result.balance,
    ledger_id: result.ledgerId,
  });
});

// ---------------------------------------------------------------------------
// GET /api/credits/history
// ---------------------------------------------------------------------------

creditWalletRollover.get('/api/credits/history', async (c) => {
  const early = await guard(c);
  if (early) return early;

  const orgId = c.get('orgId');
  if (!orgId) return unauthorized(c);

  const rows = await getCreditHistory(c.env, orgId);

  return c.json({
    org_id: orgId,
    rows,
    count: rows.length,
  });
});
