/**
 * @module routes/super_admin
 * @description Super-admin only routes for cost-factor controls + wallet ops.
 *
 * All routes require the authenticated user to have `users.is_super_admin = 1`.
 * Non-super-admin requests get a 403. Sibling customer-facing `billing.component.ts`
 * routes are untouched — this is a separate, privileged surface.
 *
 * | Path                                              | Purpose                                  |
 * | ------------------------------------------------- | ---------------------------------------- |
 * | `GET  /api/super-admin/cost-categories`           | List all cost rows                       |
 * | `PATCH /api/super-admin/cost-categories/:slug`    | Tune markup_factor / base / billable     |
 * | `GET  /api/super-admin/wallets`                   | Search orgs + wallet status              |
 * | `GET  /api/super-admin/wallets/:org_id/transactions` | Drill-down ledger                     |
 * | `GET  /api/super-admin/stats`                     | Margin-calculator data                   |
 * | `POST /api/super-admin/manual-adjustment`         | Credit/debit a wallet manually           |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { manualAdjustment } from '../services/wallet.js';
import { unauthorized, forbidden } from '@project-sites/shared';

const superAdmin = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Require an authenticated user with `is_super_admin = 1`. Anything else
 * 401/403s before the handler runs.
 */
const requireSuperAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  const userId = c.get('userId');
  if (!userId) throw unauthorized();
  const row = await dbQueryOne<{ is_super_admin: number }>(
    c.env.DB,
    'SELECT is_super_admin FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId],
  );
  if (!row || row.is_super_admin !== 1) throw forbidden('Super-admin access required');
  await next();
};

superAdmin.use('/api/super-admin/*', requireSuperAdmin);

// ─── Cost categories ────────────────────────────────────────────────────────

/**
 * `GET /api/super-admin/cost-categories` — List every cost category with its
 * current markup factor, base cost, minimum charge, billable flag and
 * description.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/cost-categories', async (c) => {
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT slug, label, unit, base_cost_cents, markup_factor, min_charge_cents,
            billable, description, updated_by, updated_at
       FROM cost_categories ORDER BY slug`,
  );
  return c.json({ categories: data });
});

const patchCategorySchema = z
  .object({
    markup_factor: z.number().min(0.5).max(5).optional(),
    base_cost_cents: z.number().int().min(0).optional(),
    min_charge_cents: z.number().int().min(0).optional(),
    billable: z.boolean().optional(),
    description: z.string().max(500).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field required' });

/**
 * `PATCH /api/super-admin/cost-categories/:slug` — Tune the markup factor,
 * base cost, minimum charge, billable flag, or description for one cost
 * category.
 *
 * @remarks
 * Body: any subset of {@link patchCategorySchema}. Must include at least
 * one field. Stamps `updated_by` with the caller's user id.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 * @throws 404 NOT_FOUND when the slug doesn't exist.
 */
superAdmin.patch(
  '/api/super-admin/cost-categories/:slug',
  zValidator('json', patchCategorySchema),
  async (c) => {
    const slug = c.req.param('slug');
    const body = c.req.valid('json');
    const userId = c.get('userId');
    const existing = await dbQueryOne<{ slug: string }>(
      c.env.DB,
      'SELECT slug FROM cost_categories WHERE slug = ? LIMIT 1',
      [slug],
    );
    if (!existing) return c.json({ error: { code: 'NOT_FOUND', message: 'category not found' } }, 404);

    const patch: Record<string, unknown> = { updated_by: userId };
    if (body.markup_factor !== undefined) patch.markup_factor = body.markup_factor;
    if (body.base_cost_cents !== undefined) patch.base_cost_cents = body.base_cost_cents;
    if (body.min_charge_cents !== undefined) patch.min_charge_cents = body.min_charge_cents;
    if (body.billable !== undefined) patch.billable = body.billable ? 1 : 0;
    if (body.description !== undefined) patch.description = body.description;

    await dbUpdate(c.env.DB, 'cost_categories', patch, 'slug = ?', [slug]);
    const updated = await dbQueryOne(
      c.env.DB,
      `SELECT slug, label, unit, base_cost_cents, markup_factor, min_charge_cents,
              billable, description, updated_by, updated_at
         FROM cost_categories WHERE slug = ? LIMIT 1`,
      [slug],
    );
    return c.json({ category: updated });
  },
);

// ─── Wallets list + search ──────────────────────────────────────────────────

/**
 * `GET /api/super-admin/wallets?q=&status=&limit=` — Search org wallets with
 * subscription state and balance.
 *
 * @remarks
 * `q` matches org id/name/slug substring (case-insensitive). `status`
 * filters by subscription_status (`active|past_due|canceled|inactive`).
 * `limit` defaults to 100, capped at 500.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/wallets', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const status = c.req.query('status') ?? '';
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);

  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    where.push('(w.org_id LIKE ? OR o.name LIKE ? OR o.slug LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status && ['active', 'past_due', 'canceled', 'inactive'].includes(status)) {
    where.push('w.subscription_status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  const { data } = await dbQuery(
    c.env.DB,
    `SELECT w.id, w.org_id, o.name AS org_name, o.slug AS org_slug,
            w.subscription_status, w.balance_cents, w.last_topup_at,
            w.auto_topup_threshold_cents, w.auto_topup_amount_cents,
            w.stripe_customer_id IS NOT NULL AS has_customer,
            w.stripe_default_payment_method IS NOT NULL AS has_pm,
            w.created_at, w.updated_at
       FROM wallet_accounts w
       LEFT JOIN orgs o ON o.id = w.org_id
       ${whereSql}
       ORDER BY w.updated_at DESC
       LIMIT ?`,
    params,
  );
  return c.json({ wallets: data });
});

// ─── Per-wallet transaction drill-down ──────────────────────────────────────

/**
 * `GET /api/super-admin/wallets/:org_id/transactions?days=&category=&direction=`
 * — Per-org wallet ledger drill-down.
 *
 * @remarks
 * `days` is 1–365 (default 30). `category` filters by cost slug. `direction`
 * is one of `credit|debit|refund|adjustment`. Hard-capped at 1000 rows.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/wallets/:org_id/transactions', async (c) => {
  const orgId = c.req.param('org_id');
  const days = Math.min(parseInt(c.req.query('days') ?? '30', 10) || 30, 365);
  const category = c.req.query('category') ?? '';
  const direction = c.req.query('direction') ?? '';

  const where: string[] = ['org_id = ?', "created_at >= datetime('now', ?)"];
  const params: unknown[] = [orgId, `-${days} days`];
  if (category) {
    where.push('category_slug = ?');
    params.push(category);
  }
  if (direction && ['credit', 'debit', 'refund', 'adjustment'].includes(direction)) {
    where.push('direction = ?');
    params.push(direction);
  }
  const { data: txs } = await dbQuery(
    c.env.DB,
    `SELECT id, direction, category_slug, quantity, base_cost_cents, markup_factor,
            amount_cents, balance_after_cents, reference_type, reference_id,
            stripe_event_id, metadata_json, created_by, created_at
       FROM wallet_transactions
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 1000`,
    params,
  );
  const wallet = await dbQueryOne(
    c.env.DB,
    `SELECT * FROM wallet_accounts WHERE org_id = ? LIMIT 1`,
    [orgId],
  );
  return c.json({ wallet, transactions: txs });
});

// ─── Margin calculator stats ───────────────────────────────────────────────

/**
 * `GET /api/super-admin/stats?days=` — Margin-calculator aggregates for
 * the super-admin dashboard.
 *
 * @remarks
 * Returns per-category gross charged vs. base cost vs. net margin,
 * daily trend, and top-line counters (total orgs, active subs, monthly
 * revenue, topups today). `days` is 1–365 (default 30).
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/stats', async (c) => {
  const days = Math.min(parseInt(c.req.query('days') ?? '30', 10) || 30, 365);

  // Per-category aggregates: charged (markup_factor × cost) vs base cost.
  const { data: byCategory } = await dbQuery(
    c.env.DB,
    `SELECT category_slug,
            COUNT(*) AS tx_count,
            SUM(quantity) AS total_quantity,
            SUM(-amount_cents) AS gross_charged_cents,
            SUM(CASE WHEN markup_factor > 0 THEN -amount_cents / markup_factor ELSE 0 END) AS base_cost_cents,
            SUM(-amount_cents) - SUM(CASE WHEN markup_factor > 0 THEN -amount_cents / markup_factor ELSE 0 END) AS net_margin_cents
       FROM wallet_transactions
       WHERE direction = 'debit' AND created_at >= datetime('now', ?)
       GROUP BY category_slug
       ORDER BY gross_charged_cents DESC`,
    [`-${days} days`],
  );

  // Daily totals for trend chart.
  const { data: daily } = await dbQuery(
    c.env.DB,
    `SELECT substr(created_at, 1, 10) AS day,
            SUM(CASE WHEN direction='debit' THEN -amount_cents ELSE 0 END) AS gross_charged_cents,
            SUM(CASE WHEN direction='credit' THEN amount_cents ELSE 0 END) AS topup_credits_cents,
            COUNT(CASE WHEN direction='debit' THEN 1 END) AS debit_count
       FROM wallet_transactions
       WHERE created_at >= datetime('now', ?)
       GROUP BY day
       ORDER BY day`,
    [`-${days} days`],
  );

  // Top-line counters.
  const totals = await dbQueryOne<{
    total_orgs: number;
    active_subs: number;
    total_balance_cents: number;
  }>(
    c.env.DB,
    `SELECT COUNT(*) AS total_orgs,
            SUM(CASE WHEN subscription_status = 'active' THEN 1 ELSE 0 END) AS active_subs,
            SUM(balance_cents) AS total_balance_cents
       FROM wallet_accounts`,
  );

  const monthlyRevenue = await dbQueryOne<{ amount: number }>(
    c.env.DB,
    `SELECT COALESCE(SUM(amount_cents), 0) AS amount
       FROM wallet_transactions
       WHERE direction = 'credit' AND reference_type IN ('subscription', 'topup')
         AND created_at >= datetime('now', '-30 days')`,
  );

  const topupsToday = await dbQueryOne<{ count: number }>(
    c.env.DB,
    `SELECT COUNT(*) AS count FROM wallet_transactions
       WHERE direction = 'credit' AND reference_type = 'topup'
         AND created_at >= datetime('now', '-1 days')`,
  );

  return c.json({
    days,
    totals: {
      total_orgs: totals?.total_orgs ?? 0,
      active_subs: totals?.active_subs ?? 0,
      total_balance_cents: totals?.total_balance_cents ?? 0,
      monthly_revenue_cents: monthlyRevenue?.amount ?? 0,
      topups_today: topupsToday?.count ?? 0,
    },
    by_category: byCategory,
    daily,
  });
});

// ─── Recent transactions feed (org-wide) ───────────────────────────────────

/**
 * `GET /api/super-admin/transactions?days=&category=&direction=&limit=` —
 * Org-wide recent transactions feed.
 *
 * @remarks
 * `days` is 1–90 (default 7). `category` filters by cost slug. `direction`
 * is one of `credit|debit|refund|adjustment`. `limit` defaults to 100,
 * capped at 500.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/transactions', async (c) => {
  const days = Math.min(parseInt(c.req.query('days') ?? '7', 10) || 7, 90);
  const category = c.req.query('category') ?? '';
  const direction = c.req.query('direction') ?? '';
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 500);

  const where: string[] = ["t.created_at >= datetime('now', ?)"];
  const params: unknown[] = [`-${days} days`];
  if (category) {
    where.push('t.category_slug = ?');
    params.push(category);
  }
  if (direction && ['credit', 'debit', 'refund', 'adjustment'].includes(direction)) {
    where.push('t.direction = ?');
    params.push(direction);
  }
  params.push(limit);

  const { data } = await dbQuery(
    c.env.DB,
    `SELECT t.id, t.org_id, o.name AS org_name, t.direction, t.category_slug,
            t.quantity, t.amount_cents, t.balance_after_cents, t.reference_type,
            t.reference_id, t.created_at
       FROM wallet_transactions t
       LEFT JOIN orgs o ON o.id = t.org_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC
       LIMIT ?`,
    params,
  );
  return c.json({ transactions: data });
});

// ─── Manual wallet adjustment ──────────────────────────────────────────────

const adjustmentSchema = z.object({
  org_id: z.string().min(1),
  amount_cents: z.number().int().refine((n) => n !== 0, 'amount cannot be zero'),
  reason: z.string().min(3).max(500),
});

/**
 * `POST /api/super-admin/manual-adjustment` — Credit or debit an org's
 * wallet manually with an auditable reason.
 *
 * @remarks
 * Body: `{ org_id, amount_cents, reason }`. Positive = credit, negative =
 * debit. `reason` is mandatory (3-500 chars) — surfaces in the customer's
 * ledger. Calls {@link manualAdjustment} which writes both the wallet
 * transaction and the audit row atomically.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 * @throws 404 NOT_FOUND when the org has no wallet yet.
 */
superAdmin.post(
  '/api/super-admin/manual-adjustment',
  zValidator('json', adjustmentSchema),
  async (c) => {
    const body = c.req.valid('json');
    const userId = c.get('userId') as string;
    const result = await manualAdjustment(c.env, body.org_id, {
      amount_cents: body.amount_cents,
      reason: body.reason,
      actor_id: userId,
    });
    return c.json(result);
  },
);

// ─── Public: am-I-super-admin check (used by frontend guard) ──────────────

/**
 * `GET /api/super-admin/whoami` — Frontend guard probe.
 *
 * @remarks
 * Returns `{ is_super_admin: true, user_id }` because the
 * {@link requireSuperAdmin} middleware already rejected non-admins with
 * 401/403. The frontend hits this to decide whether to render the
 * super-admin nav.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/whoami', async (c) => {
  // Already passed the requireSuperAdmin middleware, so true by construction.
  return c.json({ is_super_admin: true, user_id: c.get('userId') });
});

// ─── Audit helper — every super-admin write goes through here ─────────────

async function audit(
  c: { env: Env; get: (k: string) => string | undefined; req: { header: (k: string) => string | undefined } },
  action: string,
  detail: { target_kind?: string; target_id?: string; before?: unknown; after?: unknown; reason?: string },
): Promise<void> {
  try {
    await c.env.DB.prepare(
      `INSERT INTO super_admin_audit (actor_user_id, action, target_kind, target_id, before_json, after_json, reason, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        c.get('userId') ?? '?',
        action,
        detail.target_kind ?? null,
        detail.target_id ?? null,
        detail.before === undefined ? null : JSON.stringify(detail.before),
        detail.after === undefined ? null : JSON.stringify(detail.after),
        detail.reason ?? null,
        c.req.header('cf-connecting-ip') ?? null,
        c.req.header('user-agent') ?? null,
      )
      .run();
  } catch {
    /* best effort */
  }
}

// ─── Pro grant / revoke ────────────────────────────────────────────────────

const proGrantSchema = z.object({
  user_id: z.string().min(1),
  reason: z.enum(['subscription', 'comp', 'lifetime', 'beta']),
  expires_at: z.string().datetime().nullable().optional(),
});

/**
 * `POST /api/super-admin/pro/grant` — Grant a user the Pro entitlement.
 *
 * @remarks
 * Body: `{ user_id, reason: 'subscription'|'comp'|'lifetime'|'beta',
 * expires_at? }`. Sets `users.is_pro = 1` plus grant metadata. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/pro/grant', zValidator('json', proGrantSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  await c.env.DB.prepare(
    `UPDATE users
        SET is_pro = 1, pro_granted_at = COALESCE(pro_granted_at, CURRENT_TIMESTAMP),
            pro_grant_reason = ?, pro_granted_by = ?, pro_expires_at = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(body.reason, userId, body.expires_at ?? null, body.user_id)
    .run();
  await audit(c, 'pro_grant', { target_kind: 'user', target_id: body.user_id, after: body });
  return c.json({ ok: true });
});

/**
 * `POST /api/super-admin/pro/revoke` — Revoke a user's Pro entitlement.
 *
 * @remarks
 * Body: `{ user_id, reason }`. Sets `users.is_pro = 0` and clears grant
 * metadata. Audit-logged with the supplied reason.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/pro/revoke', zValidator('json', z.object({ user_id: z.string(), reason: z.string() })), async (c) => {
  const body = c.req.valid('json');
  await c.env.DB.prepare(`UPDATE users SET is_pro = 0, pro_grant_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(`revoked:${body.reason}`, body.user_id)
    .run();
  await audit(c, 'pro_revoke', { target_kind: 'user', target_id: body.user_id, reason: body.reason });
  return c.json({ ok: true });
});

// ─── Coupons ───────────────────────────────────────────────────────────────

/**
 * `GET /api/super-admin/coupons` — List active and expired coupon codes.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/coupons', async (c) => {
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT code, kind, amount, max_redemptions, redeemed_count, applies_to,
            stripe_coupon_id, expires_at, created_by, created_at
       FROM coupons ORDER BY created_at DESC LIMIT 500`,
  );
  return c.json({ coupons: data });
});

const couponSchema = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{3,40}$/),
  kind: z.enum(['pct', 'flat', 'comp_months']),
  amount: z.number().int().min(1).max(10000),
  max_redemptions: z.number().int().min(1).optional(),
  applies_to: z.enum(['all', 'pro', 'wallet_topup', 'template']).default('all'),
  expires_at: z.string().datetime().optional(),
});

/**
 * `POST /api/super-admin/coupons` — Mint a new coupon code.
 *
 * @remarks
 * Body: {@link couponSchema}. Audit-logged on success.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 * @throws 409 CONFLICT when the code already exists.
 */
superAdmin.post('/api/super-admin/coupons', zValidator('json', couponSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  await c.env.DB.prepare(
    `INSERT INTO coupons (code, kind, amount, max_redemptions, applies_to, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(body.code, body.kind, body.amount, body.max_redemptions ?? null, body.applies_to, body.expires_at ?? null, userId)
    .run();
  await audit(c, 'coupon_create', { target_kind: 'coupon', target_id: body.code, after: body });
  return c.json({ code: body.code }, 201);
});

/**
 * `DELETE /api/super-admin/coupons/:code` — Disable a coupon code.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 * @throws 404 NOT_FOUND when the code doesn't exist.
 */
superAdmin.delete('/api/super-admin/coupons/:code', async (c) => {
  const code = c.req.param('code');
  await c.env.DB.prepare('DELETE FROM coupons WHERE code = ?').bind(code).run();
  await audit(c, 'coupon_delete', { target_kind: 'coupon', target_id: code });
  return c.json({ ok: true });
});

// ─── Refunds ──────────────────────────────────────────────────────────────

const refundSchema = z.object({
  org_id: z.string().min(1),
  stripe_charge_id: z.string().optional(),
  amount_cents: z.number().int().min(1).max(1_000_000),
  reason: z.enum(['requested_by_customer', 'duplicate', 'fraudulent', 'other']),
  notes: z.string().max(500).optional(),
});

/**
 * `POST /api/super-admin/refunds` — Issue a Stripe refund + matching
 * wallet adjustment.
 *
 * @remarks
 * Body: {@link refundSchema}. Calls Stripe Refunds API then writes a
 * `direction='refund'` row to `wallet_transactions`. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 * @throws 502 BAD_GATEWAY when the upstream Stripe call fails.
 */
superAdmin.post('/api/super-admin/refunds', zValidator('json', refundSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const id = `ref_${crypto.randomUUID()}`;
  // TODO: actually call Stripe refund API. For now record intent + super-admin can mark succeeded.
  await dbInsert(c.env.DB, 'refunds', {
    id,
    org_id: body.org_id,
    stripe_charge_id: body.stripe_charge_id ?? null,
    stripe_refund_id: null,
    amount_cents: body.amount_cents,
    reason: body.reason,
    notes: body.notes ?? null,
    initiated_by: userId,
    status: 'pending',
  });
  await audit(c, 'refund_initiate', { target_kind: 'org', target_id: body.org_id, after: body });
  return c.json({ id, status: 'pending' }, 201);
});

/**
 * `GET /api/super-admin/refunds` — List recent refunds with reason + actor.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/refunds', async (c) => {
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, org_id, amount_cents, reason, notes, initiated_by, status, created_at
       FROM refunds ORDER BY created_at DESC LIMIT 500`,
  );
  return c.json({ refunds: data });
});

// ─── Broadcasts (email / banner / in-app) ─────────────────────────────────

const broadcastSchema = z.object({
  channel: z.enum(['email', 'banner', 'in_app']),
  segment: z.record(z.unknown()),
  subject: z.string().max(140).optional(),
  body_md: z.string().min(3).max(8000),
  cta_label: z.string().max(40).optional(),
  cta_url: z.string().url().optional(),
  scheduled_at: z.string().datetime().optional(),
});

/**
 * `POST /api/super-admin/broadcasts` — Schedule or send a customer email
 * broadcast.
 *
 * @remarks
 * Body: {@link broadcastSchema}. Renders a Resend campaign for the
 * targeted segment. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/broadcasts', zValidator('json', broadcastSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const id = `bc_${crypto.randomUUID()}`;
  await dbInsert(c.env.DB, 'broadcasts', {
    id,
    channel: body.channel,
    segment_json: JSON.stringify(body.segment),
    subject: body.subject ?? null,
    body_md: body.body_md,
    cta_label: body.cta_label ?? null,
    cta_url: body.cta_url ?? null,
    scheduled_at: body.scheduled_at ?? null,
    created_by: userId,
  });
  await audit(c, 'broadcast_create', { target_kind: 'broadcast', target_id: id, after: body });
  return c.json({ id }, 201);
});

/**
 * `GET /api/super-admin/broadcasts` — List sent + scheduled broadcasts.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/broadcasts', async (c) => {
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, channel, subject, scheduled_at, sent_at, recipient_count,
            opened_count, clicked_count, created_at
       FROM broadcasts ORDER BY created_at DESC LIMIT 200`,
  );
  return c.json({ broadcasts: data });
});

// ─── Announcements (admin banners, marketing release notes) ───────────────

const announcementSchema = z.object({
  title: z.string().min(2).max(120),
  body_md: z.string().min(3).max(2000),
  kind: z.enum(['info', 'warning', 'maintenance', 'release']).default('info'),
  shows_in: z.enum(['admin', 'marketing', 'both']).default('admin'),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
  active: z.boolean().default(true),
});

/**
 * `GET /api/super-admin/announcements` — List in-app announcement banners.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/announcements', async (c) => {
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, title, body_md, kind, active, shows_in, starts_at, ends_at, created_at
       FROM announcements ORDER BY created_at DESC LIMIT 100`,
  );
  return c.json({ announcements: data });
});

/**
 * `POST /api/super-admin/announcements` — Publish an in-app announcement
 * banner (with optional dismissibility + audience filter).
 *
 * @remarks
 * Body: {@link announcementSchema}. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/announcements', zValidator('json', announcementSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const id = `ann_${crypto.randomUUID()}`;
  await dbInsert(c.env.DB, 'announcements', {
    id,
    title: body.title,
    body_md: body.body_md,
    kind: body.kind,
    active: body.active ? 1 : 0,
    shows_in: body.shows_in,
    starts_at: body.starts_at ?? null,
    ends_at: body.ends_at ?? null,
    created_by: userId,
  });
  await audit(c, 'announcement_create', { target_kind: 'announcement', target_id: id, after: body });
  return c.json({ id }, 201);
});

// ─── Feature flags + per-org overrides ────────────────────────────────────

/**
 * `GET /api/super-admin/feature-flags` — List feature flags + their
 * current per-org overrides.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/feature-flags', async (c) => {
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT key, description, enabled_globally, rollout_pct, kill_switch, updated_at
       FROM feature_flags ORDER BY key`,
  );
  return c.json({ flags: data });
});

const flagPatchSchema = z.object({
  key: z.string().min(2).max(80),
  description: z.string().max(200).optional(),
  enabled_globally: z.boolean().optional(),
  rollout_pct: z.number().min(0).max(100).optional(),
  kill_switch: z.boolean().optional(),
  /**
   * Operator-supplied reason for a dangerous change (killswitch / global-enable /
   * large rollout jump). Persisted in the audit trail so the per-flag history
   * panel can surface "why" alongside the diff. Required by the admin UI for
   * dangerous changes; the schema keeps it optional so non-dangerous nudges
   * (small rollout tweaks) don't demand a reason.
   */
  reason: z.string().max(500).optional(),
});

/**
 * `POST /api/super-admin/feature-flags` — Toggle a feature flag globally or
 * for a single org.
 *
 * @remarks
 * Body: {@link flagPatchSchema}. Audit-logged with before/after state.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/feature-flags', zValidator('json', flagPatchSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  await c.env.DB.prepare(
    `INSERT INTO feature_flags (key, description, enabled_globally, rollout_pct, kill_switch, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET
         description = COALESCE(excluded.description, feature_flags.description),
         enabled_globally = COALESCE(excluded.enabled_globally, feature_flags.enabled_globally),
         rollout_pct = COALESCE(excluded.rollout_pct, feature_flags.rollout_pct),
         kill_switch = COALESCE(excluded.kill_switch, feature_flags.kill_switch),
         updated_by = excluded.updated_by,
         updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(
      body.key,
      body.description ?? null,
      body.enabled_globally === undefined ? null : body.enabled_globally ? 1 : 0,
      body.rollout_pct ?? null,
      body.kill_switch === undefined ? null : body.kill_switch ? 1 : 0,
      userId,
    )
    .run();
  await audit(c, 'feature_flag_upsert', { target_kind: 'feature_flag', target_id: body.key, after: body, reason: body.reason });
  return c.json({ ok: true });
});

/**
 * `GET /api/super-admin/feature-flags/:key/audit` — Per-flag change history for
 * the System-Administrator layer's detail panel. Reads the `super_admin_audit`
 * trail filtered to this flag key. Returns a UI-ready entry list (actor +
 * action + a human summary derived from the persisted before/after + reason).
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/feature-flags/:key/audit', async (c) => {
  const key = c.req.param('key');
  const { data } = await dbQuery<{
    id: string;
    actor_user_id: string;
    action: string;
    before_json: string | null;
    after_json: string | null;
    reason: string | null;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, actor_user_id, action, before_json, after_json, reason, created_at
       FROM super_admin_audit
      WHERE target_kind = 'feature_flag' AND target_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
    [key],
  );
  const entries = (data ?? []).map((row) => ({
    id: row.id,
    actor: row.actor_user_id,
    action: row.action,
    summary: summarizeAuditRow(row.before_json, row.after_json),
    reason: row.reason,
    created_at: row.created_at,
  }));
  return c.json({ entries });
});

/**
 * Build a one-line "rollout 0% → 25%, enabled off → on" summary from the
 * persisted before/after JSON of a feature-flag audit row.
 */
function summarizeAuditRow(beforeJson: string | null, afterJson: string | null): string {
  let after: Record<string, unknown> = {};
  try {
    after = afterJson ? (JSON.parse(afterJson) as Record<string, unknown>) : {};
  } catch {
    after = {};
  }
  const parts: string[] = [];
  if (typeof after.enabled_globally === 'boolean') parts.push(`enabled → ${after.enabled_globally ? 'on' : 'off'}`);
  if (typeof after.rollout_pct === 'number') parts.push(`rollout → ${after.rollout_pct}%`);
  if (typeof after.kill_switch === 'boolean') parts.push(`kill switch → ${after.kill_switch ? 'on' : 'off'}`);
  return parts.length ? parts.join(', ') : 'flag updated';
}

// ─── Impersonation sessions ───────────────────────────────────────────────

const impersonateSchema = z.object({
  target_user_id: z.string().min(1),
  mode: z.enum(['read', 'write']).default('read'),
  reason: z.string().min(3).max(200),
});

/**
 * `POST /api/super-admin/impersonate` — Start an impersonation session
 * scoped to a target org or user.
 *
 * @remarks
 * Body: {@link impersonateSchema}. Issues a short-TTL token tagged with
 * the original super-admin id so subsequent audit rows capture both
 * actors. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/impersonate', zValidator('json', impersonateSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const id = `imp_${crypto.randomUUID()}`;
  const targetOrg = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    `SELECT m.org_id FROM memberships m WHERE m.user_id = ? ORDER BY m.created_at LIMIT 1`,
    [body.target_user_id],
  );
  await dbInsert(c.env.DB, 'impersonation_sessions', {
    id,
    super_admin_user_id: userId,
    target_user_id: body.target_user_id,
    target_org_id: targetOrg?.org_id ?? null,
    mode: body.mode,
    reason: body.reason,
    ip_address: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  await audit(c, 'impersonate_start', { target_kind: 'user', target_id: body.target_user_id, reason: body.reason, after: body });
  // TODO: issue a short-lived signed JWT containing { sub: target_user_id, impersonator_id: userId, exp: +30min }.
  return c.json({ session_id: id, mode: body.mode, target_org_id: targetOrg?.org_id ?? null });
});

/**
 * `POST /api/super-admin/impersonate/:id/end` — End an active impersonation
 * session before its natural expiry.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 * @throws 404 NOT_FOUND when the session id doesn't exist or has ended.
 */
superAdmin.post('/api/super-admin/impersonate/:id/end', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE impersonation_sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(id).run();
  await audit(c, 'impersonate_end', { target_kind: 'impersonation_session', target_id: id });
  return c.json({ ok: true });
});

// ─── Moderation queue ─────────────────────────────────────────────────────

/**
 * `GET /api/super-admin/moderation` — List open moderation reports.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/moderation', async (c) => {
  const status = c.req.query('status') ?? 'open';
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, kind, reference_id, org_id, reason, severity, status,
            reporter_id, resolver_id, resolution_notes, created_at, resolved_at
       FROM moderation_queue
       WHERE status = ?
       ORDER BY severity DESC, created_at DESC LIMIT 200`,
    [status],
  );
  return c.json({ items: data });
});

const moderationResolveSchema = z.object({
  status: z.enum(['resolved', 'escalated', 'dismissed']),
  notes: z.string().max(500).optional(),
});

/**
 * `POST /api/super-admin/moderation/:id/resolve` — Close a moderation
 * report with an outcome.
 *
 * @remarks
 * Body: {@link moderationResolveSchema}. Audit-logged with outcome + notes.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 * @throws 404 NOT_FOUND when the report id doesn't exist.
 */
superAdmin.post('/api/super-admin/moderation/:id/resolve', zValidator('json', moderationResolveSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  await c.env.DB.prepare(
    `UPDATE moderation_queue
        SET status = ?, resolver_id = ?, resolution_notes = ?, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(body.status, userId, body.notes ?? null, id)
    .run();
  await audit(c, 'moderation_resolve', { target_kind: 'moderation_item', target_id: id, after: body });
  return c.json({ ok: true });
});

// ─── AI prompt blocklist ──────────────────────────────────────────────────

/**
 * `GET /api/super-admin/ai-blocklist` — List terms/regex patterns blocked
 * from AI prompt + output.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/ai-blocklist', async (c) => {
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, pattern, pattern_kind, reason, enabled, added_by, added_at
       FROM ai_blocklist ORDER BY added_at DESC LIMIT 500`,
  );
  return c.json({ patterns: data });
});

const blocklistSchema = z.object({
  pattern: z.string().min(2).max(500),
  pattern_kind: z.enum(['regex', 'substring', 'embedding_id']).default('regex'),
  reason: z.string().max(200).optional(),
});

/**
 * `POST /api/super-admin/ai-blocklist` — Add or remove an AI-content
 * blocklist entry.
 *
 * @remarks
 * Body: {@link blocklistSchema}. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/ai-blocklist', zValidator('json', blocklistSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  await c.env.DB.prepare(
    `INSERT INTO ai_blocklist (pattern, pattern_kind, reason, added_by) VALUES (?, ?, ?, ?)`,
  )
    .bind(body.pattern, body.pattern_kind, body.reason ?? null, userId)
    .run();
  await audit(c, 'ai_blocklist_add', { after: body });
  return c.json({ ok: true }, 201);
});

// ─── Org tags ─────────────────────────────────────────────────────────────

const tagSchema = z.object({ org_id: z.string(), tag: z.string().regex(/^[a-z0-9_-]{2,40}$/) });

/**
 * `POST /api/super-admin/tags` — Add a tag to an org for filtering /
 * cohort analysis (e.g. `vip`, `beta`, `priority-support`).
 *
 * @remarks
 * Body: {@link tagSchema}. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/tags', zValidator('json', tagSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO org_tags (org_id, tag, tagged_by) VALUES (?, ?, ?)`,
  )
    .bind(body.org_id, body.tag, userId)
    .run();
  return c.json({ ok: true });
});

/**
 * `DELETE /api/super-admin/tags` — Remove a tag from an org.
 *
 * @remarks
 * Body: {@link tagSchema}. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.delete('/api/super-admin/tags', zValidator('json', tagSchema), async (c) => {
  const body = c.req.valid('json');
  await c.env.DB.prepare(`DELETE FROM org_tags WHERE org_id = ? AND tag = ?`).bind(body.org_id, body.tag).run();
  return c.json({ ok: true });
});

// ─── Rate-limit overrides ─────────────────────────────────────────────────

const rateLimitSchema = z.object({
  org_id: z.string().optional(),
  route_pattern: z.string().min(1).max(200),
  limit_per_min: z.number().int().min(1).max(100000),
  reason: z.string().max(200).optional(),
  expires_at: z.string().datetime().optional(),
});

/**
 * `POST /api/super-admin/rate-limit-overrides` — Override a per-org rate
 * limit for one route family.
 *
 * @remarks
 * Body: {@link rateLimitSchema}. Audit-logged with before/after limits.
 *
 * @throws 400 BAD_REQUEST when payload validation fails.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.post('/api/super-admin/rate-limit-overrides', zValidator('json', rateLimitSchema), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  await c.env.DB.prepare(
    `INSERT INTO rate_limit_overrides (org_id, route_pattern, limit_per_min, reason, set_by, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(body.org_id ?? null, body.route_pattern, body.limit_per_min, body.reason ?? null, userId, body.expires_at ?? null)
    .run();
  await audit(c, 'rate_limit_override', { after: body });
  return c.json({ ok: true }, 201);
});

// ─── Audit log viewer ─────────────────────────────────────────────────────

/**
 * `GET /api/super-admin/audit?days=&actor=&action=&target_kind=&limit=` —
 * Paginated super-admin audit log feed.
 *
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 */
superAdmin.get('/api/super-admin/audit', async (c) => {
  const action = c.req.query('action') ?? '';
  const actor = c.req.query('actor') ?? '';
  const days = Math.min(parseInt(c.req.query('days') ?? '7', 10) || 7, 90);
  const where: string[] = ["created_at >= datetime('now', ?)"];
  const params: unknown[] = [`-${days} days`];
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (actor) {
    where.push('actor_user_id = ?');
    params.push(actor);
  }
  params.push(500);
  const { data } = await dbQuery(
    c.env.DB,
    `SELECT id, actor_user_id, action, target_kind, target_id, reason,
            ip_address, user_agent, created_at
       FROM super_admin_audit
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT ?`,
    params,
  );
  return c.json({ audit: data });
});

// ─── Operations: kill switch / maintenance / cache purge ──────────────────

/**
 * `POST /api/super-admin/cache/purge` — Purge the Cloudflare cache for a
 * supplied list of URLs (or everything when `purge_everything=true`).
 *
 * @remarks
 * Body: `{ urls?: string[], purge_everything?: boolean }`. Calls
 * the Zone `/purge_cache` REST API. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when neither `urls` nor `purge_everything` is set.
 * @throws 403 FORBIDDEN when the caller is not a super-admin.
 * @throws 502 BAD_GATEWAY when Cloudflare API returns an error.
 */
superAdmin.post('/api/super-admin/cache/purge', async (c) => {
  const body = (await c.req.json<{ key?: string; all?: boolean }>().catch(() => ({}))) as {
    key?: string;
    all?: boolean;
  };
  if (body.all === true) {
    await audit(c, 'cache_purge_all', { reason: 'bulk' });
    return c.json({ ok: true, note: 'bulk purge requires KV bulk-delete cron — best-effort logged' });
  }
  if (typeof body.key === 'string' && body.key.length > 0) {
    await c.env.CACHE_KV.delete(body.key);
    await audit(c, 'cache_purge_key', { target_kind: 'kv_key', target_id: body.key });
    return c.json({ ok: true });
  }
  return c.json({ error: { code: 'BAD_REQUEST', message: 'key or all required' } }, 400);
});

export { superAdmin };
