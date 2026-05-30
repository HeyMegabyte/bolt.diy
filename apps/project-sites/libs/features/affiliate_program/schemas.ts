/**
 * @module libs/features/affiliate_program/schemas
 * @description Zod schemas for the Affiliate Program (idea #32).
 *
 * Single source of truth for runtime shapes used by the affiliate service +
 * Hono handlers. Mirrors the D1 columns defined in migration 0527.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ─── Status enums ─────────────────────────────────────────────

export const AffiliateStatusSchema = z.enum(['active', 'suspended']);
export type AffiliateStatus = z.infer<typeof AffiliateStatusSchema>;

export const ReferralStatusSchema = z.enum(['clicked', 'signed_up', 'converted']);
export type ReferralStatus = z.infer<typeof ReferralStatusSchema>;

export const CommissionStatusSchema = z.enum(['pending', 'paid', 'void']);
export type CommissionStatus = z.infer<typeof CommissionStatusSchema>;

// ─── Core records ─────────────────────────────────────────────

/** An enrolled affiliate partner. */
export const AffiliateSchema = z.object({
  code: z
    .string()
    .min(6)
    .max(32)
    .regex(/^[A-Z0-9]+$/, 'Code must be uppercase alphanumeric'),
  ownerEmail: z.string().email().max(254),
  stripeConnectId: z.string().max(64).optional(),
  status: AffiliateStatusSchema.default('active'),
});
export type Affiliate = z.infer<typeof AffiliateSchema>;

/** One attribution record binding a visitor to an affiliate code. */
export const AffiliateReferralSchema = z.object({
  visitorAnonId: z.string().min(1).max(128),
  affiliateCode: z
    .string()
    .min(6)
    .max(32)
    .regex(/^[A-Z0-9]+$/),
  signedUpOrgId: z.string().max(64).optional(),
  convertedAt: z.string().datetime().optional(),
  status: ReferralStatusSchema.default('clicked'),
});
export type AffiliateReferral = z.infer<typeof AffiliateReferralSchema>;

/** One accrued recurring-month commission (50% of that month's MRR). */
export const CommissionSchema = z.object({
  amountUsd: z.number().nonnegative(),
  pct: z.literal(50).default(50),
  recurringMonth: z.number().int().min(1).max(12),
  status: CommissionStatusSchema.default('pending'),
});
export type Commission = z.infer<typeof CommissionSchema>;

// ─── Request bodies ──────────────────────────────────────────

/** `POST /api/affiliate/enroll` */
export const EnrollRequestSchema = z.object({
  email: z.string().email().max(254),
  stripeConnectId: z.string().max(64).optional(),
});
export type EnrollRequest = z.infer<typeof EnrollRequestSchema>;

/** `POST /api/affiliate/payout` */
export const PayoutRequestSchema = z.object({
  /** Optional explicit affiliate code; defaults to the caller's enrolled code. */
  code: z
    .string()
    .min(6)
    .max(32)
    .regex(/^[A-Z0-9]+$/)
    .optional(),
});
export type PayoutRequest = z.infer<typeof PayoutRequestSchema>;

// ─── Response shapes ─────────────────────────────────────────

/** `GET /api/affiliate/me` dashboard payload. */
export const AffiliateDashboardSchema = z.object({
  code: z.string(),
  owner_email: z.string(),
  status: AffiliateStatusSchema,
  share_url: z.string(),
  stripe_connect_id: z.string().nullable(),
  /** Total attribution clicks. */
  clicks: z.number().int().nonnegative(),
  /** Referrals that converted to a paid subscription. */
  conversions: z.number().int().nonnegative(),
  /** Sum of pending (unpaid) commission, in USD. */
  pending_commission_usd: z.number().nonnegative(),
  /** Sum of paid commission, in USD. */
  paid_commission_usd: z.number().nonnegative(),
  /** Whether a Stripe Connect payout can currently be requested. */
  payout_ready: z.boolean(),
});
export type AffiliateDashboard = z.infer<typeof AffiliateDashboardSchema>;

// ─── Constants ───────────────────────────────────────────────

/** Commission percent on referred MRR — the Framer model. */
export const COMMISSION_PCT = 50;
/** Number of recurring months a referral keeps paying out. */
export const COMMISSION_MONTHS = 12;
/** Tracking-code length we mint. Easy to type, hard to collide. */
export const AFFILIATE_CODE_LENGTH = 10;
/** Attribution cookie name set on `/r/:code`. */
export const ATTRIBUTION_COOKIE = 'ps_aff';
/** Attribution cookie lifetime (90 days, in seconds). */
export const ATTRIBUTION_COOKIE_MAX_AGE = 90 * 24 * 60 * 60;
