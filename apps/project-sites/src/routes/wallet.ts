/**
 * @module routes/wallet
 * @description Customer-facing wallet API.
 *
 * | Path                              | Purpose                              |
 * | --------------------------------- | ------------------------------------ |
 * | `GET  /api/wallet`                | Current wallet balance + status      |
 * | `POST /api/wallet/subscribe`      | Start $50/mo subscription checkout   |
 * | `POST /api/wallet/topup`          | Manual top-up (charges stored PM)    |
 * | `GET  /api/wallet/transactions`   | Org's own transaction ledger         |
 * | `GET  /api/wallet/cost-categories`| Read-only catalog (for UI rendering) |
 *
 * Sibling `/api/billing/*` routes are untouched — that's the legacy
 * tier-based subscription surface. The wallet surface is additive.
 *
 * Sibling `routes/domain_purchase.ts` also serves `/api/billing/wallet`,
 * `/api/billing/checkout/wallet`, `/api/billing/topup` against the same
 * service layer; these `/api/wallet/*` aliases coexist without conflict.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne } from '../services/db.js';
import { getWalletState, startSubscription, topUpWallet } from '../services/wallet.js';
import { unauthorized } from '@project-sites/shared';

const wallet = new Hono<{ Bindings: Env; Variables: Variables }>();

wallet.get('/api/wallet', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const state = await getWalletState(c.env, orgId);
  return c.json(state);
});

wallet.post(
  '/api/wallet/subscribe',
  zValidator('json', z.object({ return_url: z.string().url() })),
  async (c) => {
    const orgId = c.get('orgId');
    const userId = c.get('userId');
    if (!orgId || !userId) throw unauthorized();
    const user = await dbQueryOne<{ email: string }>(
      c.env.DB,
      'SELECT email FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    const { return_url } = c.req.valid('json');
    const result = await startSubscription(c.env, orgId, {
      success_url: `${return_url}?wallet=active`,
      cancel_url: `${return_url}?wallet=canceled`,
      email: user?.email,
    });
    if (!result.ok) return c.json({ error: { code: 'CHECKOUT_FAILED', message: result.message } }, 400);
    return c.json({ checkout_url: result.checkout_url });
  },
);

wallet.post('/api/wallet/topup', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  // Default top-up = $50 (wallet.auto_topup_amount_cents) — caller can override.
  const body = (await c.req.json<{ amount_cents?: number }>().catch(() => ({}))) as {
    amount_cents?: number;
  };
  const amount = Math.max(100, Math.min(50000, Number(body.amount_cents) || 5000));
  const result = await topUpWallet(c.env, orgId, amount);
  return c.json(result);
});

wallet.get('/api/wallet/transactions', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized();
  const days = Math.min(parseInt(c.req.query('days') ?? '30', 10) || 30, 365);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, direction, category_slug, quantity, amount_cents, balance_after_cents,
            reference_type, reference_id, created_at
       FROM wallet_transactions
       WHERE org_id = ? AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC LIMIT 500`,
    [orgId, `-${days} days`],
  );
  return c.json({ transactions: data });
});

wallet.get('/api/wallet/cost-categories', async (c) => {
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT slug, label, unit, base_cost_cents, markup_factor, billable
       FROM cost_categories WHERE billable = 1 ORDER BY slug`,
  );
  return c.json({ categories: data });
});

export { wallet };
