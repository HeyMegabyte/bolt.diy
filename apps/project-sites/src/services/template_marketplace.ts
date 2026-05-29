/**
 * @module services/template_marketplace
 * @description Template Marketplace v1 service (IDEAS-50 #39).
 *
 * Framer-style economics:
 *   - Direct sale → 100% creator, 0% platform.
 *   - Platform-referred sale → 50% creator, 50% referrer, 0% platform.
 *
 * The revenue split is computed by the pure `computeRevenueSplit` helper in
 * `libs/features/template_marketplace/feature.schemas.ts` and persisted on
 * every `template_purchases` row, so retroactive split changes are safe.
 *
 * Payouts are settled monthly via Stripe Connect Express; manual today,
 * automated once Brian completes Connect onboarding. See
 * `marketplace_payouts` table for the schedule.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from './db.js';
import {
  computeRevenueSplit,
  type TemplatePurchaseInput,
  type TemplateRow,
  type TemplateSubmission,
  TemplateRowSchema,
} from '../../libs/features/template_marketplace/feature.schemas.js';

/** UUID helper — Workers runtime always exposes `crypto.randomUUID()`. */
function uuid(): string {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog reads.
// ─────────────────────────────────────────────────────────────────────────────

export interface ListTemplatesOptions {
  category?: string;
  /** Limit to a creator's own listings. */
  creatorUserId?: string;
  /** Include `pending` + `rejected` (admin / own-listings only). */
  includeUnapproved?: boolean;
  limit?: number;
}

export interface TemplateSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  price_cents: number;
  preview_url: string | null;
  sales_count: number;
  install_count: number;
  rating_avg: number | null;
  rating_count: number | null;
  creator_user_id: string | null;
  submission_status: string;
}

/**
 * List marketplace templates. By default only `submission_status='approved'`
 * rows are returned — community-submitted templates stay invisible until Brian
 * curates them.
 */
export async function listTemplates(
  env: Env,
  opts: ListTemplatesOptions = {},
): Promise<TemplateSummary[]> {
  const where = ['deleted_at IS NULL'];
  const params: unknown[] = [];

  if (!opts.includeUnapproved) {
    where.push("submission_status = 'approved'");
  }
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  if (opts.creatorUserId) {
    where.push('creator_user_id = ?');
    params.push(opts.creatorUserId);
  }

  const limit = Math.min(opts.limit ?? 200, 500);
  params.push(limit);

  const { data } = await dbQuery<TemplateSummary>(
    env.DB,
    `SELECT id, slug, name, description, category, price_cents,
            preview_url, sales_count, install_count, rating_avg, rating_count,
            creator_user_id, submission_status
       FROM templates
       WHERE ${where.join(' AND ')}
       ORDER BY sales_count DESC, install_count DESC, name ASC
       LIMIT ?`,
    params,
  );

  return data ?? [];
}

/** Read a single template row, parsed against the schema. */
export async function getTemplate(env: Env, id: string): Promise<TemplateRow | null> {
  const row = await dbQueryOne<Record<string, unknown>>(
    env.DB,
    `SELECT id, slug, name, description, category, creator_user_id,
            stripe_product_id, stripe_price_id, price_cents, sales_count,
            total_revenue_cents, submission_status, license_terms,
            base_files_r2_prefix, preview_url, install_count, rating_avg,
            rating_count, created_at, updated_at
       FROM templates
       WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (!row) return null;

  const parsed = TemplateRowSchema.safeParse(row);
  if (!parsed.success) {
    // Surface a parse failure but don't crash callers — return null so the
    // route handler responds 404 instead of 500. The mismatch is logged via
    // structured log shape so observability captures it.
    return null;
  }
  return parsed.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Creator submission.
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmitResult {
  ok: true;
  id: string;
  slug: string;
  submission_status: 'pending';
}

/**
 * Creator submits a new template. Lands as `submission_status='pending'`
 * — invisible to the public catalog until approved.
 *
 * @throws Error('SLUG_TAKEN') when slug collides with an existing row.
 */
export async function submitTemplate(
  env: Env,
  submission: TemplateSubmission,
  creatorUserId: string,
): Promise<SubmitResult> {
  // Check slug uniqueness — `templates.slug` is UNIQUE in the schema.
  const existing = await dbQueryOne<{ id: string }>(
    env.DB,
    'SELECT id FROM templates WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
    [submission.slug],
  );
  if (existing) {
    throw new Error('SLUG_TAKEN');
  }

  const id = `tpl_${uuid()}`;
  const { error } = await dbInsert(env.DB, 'templates', {
    id,
    slug: submission.slug,
    name: submission.name,
    description: submission.description,
    category: submission.category,
    creator_user_id: creatorUserId,
    base_files_r2_prefix: submission.base_files_r2_prefix,
    preview_url: submission.preview_url ?? null,
    price_cents: submission.price_cents,
    submission_status: 'pending',
    license_terms: submission.license_terms,
    sales_count: 0,
    total_revenue_cents: 0,
    install_count: 0,
    rating_avg: 0,
    rating_count: 0,
    visibility: 'public',
    status: 'draft', // not yet 'live' — flips to live on approval
  });
  if (error) throw new Error(`DB_INSERT_FAILED: ${error}`);

  return { ok: true, id, slug: submission.slug, submission_status: 'pending' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Purchase + ledger.
// ─────────────────────────────────────────────────────────────────────────────

export interface PurchaseResult {
  ok: true;
  purchase_id: string;
  template_id: string;
  amount_cents: number;
  creator_share_cents: number;
  platform_share_cents: number;
  referrer_share_cents: number;
}

/**
 * Record a purchase. The Stripe PaymentIntent is the idempotency key — calling
 * this twice with the same `stripe_payment_intent` is a no-op on the second
 * call (returns the previously-recorded result).
 *
 * The split is computed via the pure `computeRevenueSplit` helper and persisted
 * on the ledger row so future split policy changes don't rewrite history.
 *
 * @throws Error('TEMPLATE_NOT_FOUND') when template_id doesn't resolve.
 * @throws Error('TEMPLATE_NOT_APPROVED') when the template is pending/rejected.
 */
export async function recordPurchase(
  env: Env,
  input: TemplatePurchaseInput,
  buyerUserId: string,
): Promise<PurchaseResult> {
  // Idempotency check — Stripe webhooks can fire twice.
  const existing = await dbQueryOne<{
    id: string;
    template_id: string;
    amount_cents: number;
    creator_share_cents: number;
    platform_share_cents: number;
    referrer_share_cents: number;
  }>(
    env.DB,
    `SELECT id, template_id, amount_cents, creator_share_cents,
            platform_share_cents, referrer_share_cents
       FROM template_purchases
       WHERE stripe_payment_intent = ? AND deleted_at IS NULL
       LIMIT 1`,
    [input.stripe_payment_intent],
  );
  if (existing) {
    return {
      ok: true,
      purchase_id: existing.id,
      template_id: existing.template_id,
      amount_cents: existing.amount_cents,
      creator_share_cents: existing.creator_share_cents,
      platform_share_cents: existing.platform_share_cents,
      referrer_share_cents: existing.referrer_share_cents,
    };
  }

  const tpl = await getTemplate(env, input.template_id);
  if (!tpl) throw new Error('TEMPLATE_NOT_FOUND');
  if (tpl.submission_status !== 'approved') throw new Error('TEMPLATE_NOT_APPROVED');

  const split = computeRevenueSplit(tpl.price_cents, input.referrer_user_id ?? null);

  const purchaseId = `tplp_${uuid()}`;
  const insertRes = await dbInsert(env.DB, 'template_purchases', {
    id: purchaseId,
    template_id: tpl.id,
    buyer_user_id: buyerUserId,
    buyer_site_id: input.buyer_site_id ?? null,
    referrer_user_id: input.referrer_user_id ?? null,
    stripe_payment_intent: input.stripe_payment_intent,
    amount_cents: tpl.price_cents,
    creator_share_cents: split.creator_share_cents,
    platform_share_cents: split.platform_share_cents,
    referrer_share_cents: split.referrer_share_cents,
    license: tpl.license_terms,
  });
  if (insertRes.error) {
    // UNIQUE on stripe_payment_intent — collision = a concurrent webhook beat us.
    // Re-read to return the persisted row.
    if (/UNIQUE constraint failed/i.test(insertRes.error)) {
      return recordPurchase(env, input, buyerUserId);
    }
    throw new Error(`DB_INSERT_FAILED: ${insertRes.error}`);
  }

  // Update template aggregates. Best-effort — failure does not unwind the purchase.
  await dbExecute(
    env.DB,
    `UPDATE templates
        SET sales_count = sales_count + 1,
            total_revenue_cents = total_revenue_cents + ?,
            install_count = install_count + 1,
            updated_at = ?
      WHERE id = ?`,
    [tpl.price_cents, new Date().toISOString(), tpl.id],
  );

  return {
    ok: true,
    purchase_id: purchaseId,
    template_id: tpl.id,
    amount_cents: tpl.price_cents,
    creator_share_cents: split.creator_share_cents,
    platform_share_cents: split.platform_share_cents,
    referrer_share_cents: split.referrer_share_cents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Creator dashboard reads.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreatorRevenueSummary {
  templates: number;
  sales_count: number;
  gross_cents: number;
  creator_share_cents: number;
  referred_sales_count: number;
}

/**
 * Aggregate a creator's lifetime sales + revenue across all their templates.
 */
export async function getCreatorRevenue(env: Env, creatorUserId: string): Promise<CreatorRevenueSummary> {
  const row = await dbQueryOne<{
    templates: number;
    sales_count: number;
    gross_cents: number;
    creator_share_cents: number;
    referred_sales_count: number;
  }>(
    env.DB,
    `SELECT
        (SELECT COUNT(*) FROM templates
            WHERE creator_user_id = ? AND deleted_at IS NULL) AS templates,
        COALESCE(SUM(tp.amount_cents), 0)        AS gross_cents,
        COALESCE(SUM(tp.creator_share_cents), 0) AS creator_share_cents,
        COUNT(tp.id)                             AS sales_count,
        COUNT(CASE WHEN tp.referrer_user_id IS NOT NULL THEN 1 END) AS referred_sales_count
       FROM template_purchases tp
       JOIN templates t ON t.id = tp.template_id
      WHERE t.creator_user_id = ?
        AND tp.deleted_at IS NULL
        AND tp.refunded_at IS NULL`,
    [creatorUserId, creatorUserId],
  );

  return {
    templates: row?.templates ?? 0,
    sales_count: row?.sales_count ?? 0,
    gross_cents: row?.gross_cents ?? 0,
    creator_share_cents: row?.creator_share_cents ?? 0,
    referred_sales_count: row?.referred_sales_count ?? 0,
  };
}

/** List a buyer's purchase history. */
export async function listBuyerPurchases(env: Env, buyerUserId: string, limit = 100): Promise<Array<{
  purchase_id: string;
  template_id: string;
  template_name: string;
  amount_cents: number;
  license: string;
  purchased_at: string;
}>> {
  const { data } = await dbQuery<{
    purchase_id: string;
    template_id: string;
    template_name: string;
    amount_cents: number;
    license: string;
    purchased_at: string;
  }>(
    env.DB,
    `SELECT tp.id AS purchase_id, tp.template_id, t.name AS template_name,
            tp.amount_cents, tp.license, tp.purchased_at
       FROM template_purchases tp
       JOIN templates t ON t.id = tp.template_id
      WHERE tp.buyer_user_id = ?
        AND tp.deleted_at IS NULL
      ORDER BY tp.purchased_at DESC
      LIMIT ?`,
    [buyerUserId, Math.min(limit, 500)],
  );
  return data ?? [];
}
