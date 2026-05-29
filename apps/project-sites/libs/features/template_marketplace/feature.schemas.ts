/**
 * @module libs/features/template_marketplace/schemas
 * @description Zod schemas for the Template Marketplace v1 feature module (IDEAS-50 #39).
 *
 * Framer-style economics: creator keeps 100% on direct sales + 50% on
 * platform-referred conversions. The split is stored on each `template_purchases`
 * row as `creator_share_cents` + `platform_share_cents` + `referrer_share_cents`
 * so the ledger is authoritative and the schedule survives future split changes.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Economics constants — single source of truth for split arithmetic.
// ─────────────────────────────────────────────────────────────────────────────

/** Direct-sale platform fee (0% — Framer parity). */
export const DIRECT_PLATFORM_FEE_BPS = 0;
/** Platform-referred sale: creator keeps 50%, platform takes 50%. */
export const REFERRAL_PLATFORM_FEE_BPS = 5000;
/** Referrer (the platform/affiliate) share on a referred sale. */
export const REFERRAL_REFERRER_BPS = 5000;
/** Helper: 100% in basis points. */
export const BPS_FULL = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// License terms — what the buyer is allowed to do with the template.
// ─────────────────────────────────────────────────────────────────────────────

export const TemplateLicenseSchema = z.enum(['single-site', 'unlimited', 'agency']);
export type TemplateLicense = z.infer<typeof TemplateLicenseSchema>;

export const TemplateSubmissionStatusSchema = z.enum(['pending', 'approved', 'rejected']);
export type TemplateSubmissionStatus = z.infer<typeof TemplateSubmissionStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Submission — creator → marketplace.
// ─────────────────────────────────────────────────────────────────────────────

export const TemplateSubmissionSchema = z.object({
  /** Stable URL slug. Lowercase + hyphens. */
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric + hyphens'),
  /** Human-readable template name. */
  name: z.string().min(3).max(120),
  /** Short marketing description. */
  description: z.string().min(20).max(500),
  /** Industry / vertical. */
  category: z.string().min(2).max(40),
  /** Optional preview URL (creator-hosted demo). */
  preview_url: z.string().url().optional(),
  /** Price in cents. 0 = free, ≥100 = paid. */
  price_cents: z
    .number()
    .int()
    .min(0)
    .max(100_000), // $1,000 cap
  /** R2 prefix the creator already uploaded the template files to. */
  base_files_r2_prefix: z.string().min(1),
  /** License terms the creator is offering. */
  license_terms: TemplateLicenseSchema.default('single-site'),
});

export type TemplateSubmission = z.infer<typeof TemplateSubmissionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Purchase — buyer → ledger.
// ─────────────────────────────────────────────────────────────────────────────

export const TemplatePurchaseInputSchema = z.object({
  template_id: z.string().min(1),
  /** Site to install the template into (optional — buyer may purchase without immediate install). */
  buyer_site_id: z.string().optional(),
  /** Referral attribution — non-null = 50/50 split path. */
  referrer_user_id: z.string().optional(),
  /** Stripe PaymentIntent id from successful confirmation on the client. */
  stripe_payment_intent: z.string().min(1),
});

export type TemplatePurchaseInput = z.infer<typeof TemplatePurchaseInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Persistence row shapes.
// ─────────────────────────────────────────────────────────────────────────────

export const TemplateRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string(),
  creator_user_id: z.string().nullable().optional(),
  stripe_product_id: z.string().nullable().optional(),
  stripe_price_id: z.string().nullable().optional(),
  price_cents: z.number().int().nonnegative(),
  sales_count: z.number().int().nonnegative(),
  total_revenue_cents: z.number().int().nonnegative(),
  submission_status: TemplateSubmissionStatusSchema,
  license_terms: TemplateLicenseSchema,
  base_files_r2_prefix: z.string(),
  preview_url: z.string().nullable().optional(),
  install_count: z.number().int().nonnegative(),
  rating_avg: z.number().nullable().optional(),
  rating_count: z.number().int().nonnegative().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
});

export type TemplateRow = z.infer<typeof TemplateRowSchema>;

export const TemplatePurchaseRowSchema = z.object({
  id: z.string(),
  template_id: z.string(),
  buyer_user_id: z.string(),
  buyer_site_id: z.string().nullable().optional(),
  referrer_user_id: z.string().nullable().optional(),
  stripe_payment_intent: z.string(),
  amount_cents: z.number().int().nonnegative(),
  creator_share_cents: z.number().int().nonnegative(),
  platform_share_cents: z.number().int().nonnegative(),
  referrer_share_cents: z.number().int().nonnegative(),
  license: TemplateLicenseSchema,
  purchased_at: z.string(),
  refunded_at: z.string().nullable().optional(),
});

export type TemplatePurchaseRow = z.infer<typeof TemplatePurchaseRowSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Pure split calculator — used in both runtime and tests.
// ─────────────────────────────────────────────────────────────────────────────

export interface RevenueSplit {
  creator_share_cents: number;
  platform_share_cents: number;
  referrer_share_cents: number;
}

/**
 * Pure function: compute revenue split for a sale.
 *
 * - Direct sale (no referrer) → 100% creator, 0% platform.
 * - Platform-referred sale    → 50% creator, 50% referrer, 0% platform.
 *
 * The platform takes 0% on direct sales (Framer parity) and routes the 50%
 * cut on referred sales entirely to the referrer (who in many cases IS the
 * platform, but is modeled as a separate party for affiliate flexibility).
 *
 * @example
 * computeRevenueSplit(10_000, null)
 * //=> { creator_share_cents: 10_000, platform_share_cents: 0, referrer_share_cents: 0 }
 *
 * @example
 * computeRevenueSplit(10_000, 'usr_referrer_1')
 * //=> { creator_share_cents: 5_000, platform_share_cents: 0, referrer_share_cents: 5_000 }
 */
export function computeRevenueSplit(amountCents: number, referrerUserId: string | null | undefined): RevenueSplit {
  if (!Number.isFinite(amountCents) || amountCents < 0 || !Number.isInteger(amountCents)) {
    throw new RangeError(`amount_cents must be a non-negative integer (got ${amountCents})`);
  }

  if (referrerUserId && referrerUserId.length > 0) {
    const creator = Math.floor((amountCents * (BPS_FULL - REFERRAL_REFERRER_BPS)) / BPS_FULL);
    const referrer = amountCents - creator;
    return { creator_share_cents: creator, platform_share_cents: 0, referrer_share_cents: referrer };
  }

  // Direct sale — 100% creator.
  return { creator_share_cents: amountCents, platform_share_cents: 0, referrer_share_cents: 0 };
}
