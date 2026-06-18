/**
 * @module libs/features/referral_loop/schemas
 * @description Zod schemas for the Referral Loop feature module.
 *
 * All API boundaries — request params, database row shapes, and API responses —
 * are validated here. Import from this file; never duplicate schema definitions.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Database row shapes (D1 read → parse → typed domain object)
// ---------------------------------------------------------------------------

/** A referral code row as stored in D1. */
export const ReferralCodeRowSchema = z
  .object({
    id: z.string().min(1),
    org_id: z.string().min(1),
    code: z.string().min(1),
    clicks: z.number().int().nonnegative().default(0),
    conversions: z.number().int().nonnegative().default(0),
    created_at: z.string(),
  })
  .strict();

export type ReferralCodeRow = z.infer<typeof ReferralCodeRowSchema>;

/** A referral attribution row as stored in D1. */
export const ReferralAttributionRowSchema = z
  .object({
    id: z.string().min(1),
    referral_code_id: z.string().min(1),
    referred_org_id: z.string().nullable().default(null),
    status: z.enum(['click', 'signup', 'converted']),
    converted_at: z.string().nullable().default(null),
    created_at: z.string(),
  })
  .strict();

export type ReferralAttributionRow = z.infer<typeof ReferralAttributionRowSchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** POST /api/referral/track — body */
export const TrackReferralBodySchema = z
  .object({
    /** The referral code string scanned from the query param. */
    code: z.string().min(1).max(64),
    /** Optionally associate the click with a known org immediately. */
    referred_org_id: z.string().optional(),
  })
  .strict();

export type TrackReferralBody = z.infer<typeof TrackReferralBodySchema>;

// ---------------------------------------------------------------------------
// API response shapes
// ---------------------------------------------------------------------------

/** GET /api/referral/code */
export const ReferralCodeResponseSchema = z
  .object({
    code: z.string().min(1),
    referral_url: z.string().url(),
    clicks: z.number().int().nonnegative(),
    conversions: z.number().int().nonnegative(),
  })
  .strict();

export type ReferralCodeResponse = z.infer<typeof ReferralCodeResponseSchema>;

/** POST /api/referral/track */
export const TrackReferralResponseSchema = z
  .object({
    attribution_id: z.string().min(1),
    status: z.enum(['click', 'signup', 'converted']),
  })
  .strict();

export type TrackReferralResponse = z.infer<typeof TrackReferralResponseSchema>;

/** GET /api/referral/stats */
export const ReferralStatsResponseSchema = z
  .object({
    // `null` when the org has no referral code yet (zero-stats state).
    code: z.string().min(1).nullable(),
    clicks: z.number().int().nonnegative(),
    conversions: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
  })
  .strict();

export type ReferralStatsResponse = z.infer<typeof ReferralStatsResponseSchema>;
