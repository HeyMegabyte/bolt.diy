/**
 * @module libs/features/referral_loop/schemas
 * @description Zod schemas for the Built-In Referral Loop (idea #33).
 *
 * Single source of truth for runtime shapes used by the referrals service
 * + Hono handlers. Mirrors the D1 columns defined in migration 0520.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ─── Status enums ─────────────────────────────────────────────

export const ReferralStatusSchema = z.enum([
  'pending',
  'clicked',
  'signed_up',
  'converted',
  'expired',
]);
export type ReferralStatus = z.infer<typeof ReferralStatusSchema>;

export const RewardSideSchema = z.enum(['referrer', 'referee']);
export type RewardSide = z.infer<typeof RewardSideSchema>;

export const RewardTypeSchema = z.enum([
  'credit_cents',
  'pro_days',
  'credit_pack',
]);
export type RewardType = z.infer<typeof RewardTypeSchema>;

export const RewardStatusSchema = z.enum([
  'active',
  'redeemed',
  'expired',
  'revoked',
]);
export type RewardStatus = z.infer<typeof RewardStatusSchema>;

// ─── Request bodies ──────────────────────────────────────────

/** `POST /api/referrals/invite` */
export const InviteRequestSchema = z.object({
  email: z.string().email().max(254),
  source: z.string().max(32).optional(),
});
export type InviteRequest = z.infer<typeof InviteRequestSchema>;

/** `POST /api/referrals/claim?code=...` body (may be empty) */
export const ClaimRequestSchema = z.object({
  code: z
    .string()
    .min(6)
    .max(32)
    .regex(/^[A-Z0-9]+$/, 'Code must be uppercase alphanumeric'),
});
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;

// ─── Response shapes ─────────────────────────────────────────

export const ReferralRecordSchema = z.object({
  id: z.string(),
  code: z.string(),
  referee_email: z.string(),
  status: ReferralStatusSchema,
  source: z.string().nullable(),
  created_at: z.string(),
  converted_at: z.string().nullable(),
});
export type ReferralRecord = z.infer<typeof ReferralRecordSchema>;

export const ReferralStatsSchema = z.object({
  /** Total invites sent. */
  invites_sent: z.number().int().nonnegative(),
  /** Invites that reached `signed_up`. */
  signups: z.number().int().nonnegative(),
  /** Invites that reached `converted` (paying or activated). */
  conversions: z.number().int().nonnegative(),
  /** Viral coefficient `k` = conversions / referrers, rounded to 3dp. */
  k_coefficient: z.number().nonnegative(),
  /** Lifetime credit value granted to this referrer (cents). */
  rewards_earned_cents: z.number().int().nonnegative(),
  /** Lifetime Pro-day extensions granted to this referrer. */
  rewards_pro_days: z.number().int().nonnegative(),
});
export type ReferralStats = z.infer<typeof ReferralStatsSchema>;

// ─── Reward grant constants ─────────────────────────────────

/** Days of Pro the referrer earns when their invite converts. */
export const REFERRER_PRO_DAYS = 30;
/** Days of free Pro the referee gets when they claim. */
export const REFEREE_PRO_DAYS = 30;
/** Code length we mint. Easy to type, hard to collide. */
export const REFERRAL_CODE_LENGTH = 10;
