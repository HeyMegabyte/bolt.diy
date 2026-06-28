/**
 * @module libs/features/upgrade_moments/schemas
 * @description Zod schemas for the Upgrade Moments feature module.
 *
 * Upgrade Moments are contextual, friction-point upsell payloads. Each "moment"
 * maps a free-plan friction point (custom domain, branding removal, page cap,
 * AI credits, build priority, analytics depth) to a tailored, honest upsell with
 * a value metric. This is the generous-free + paid-power-ups monetization seam.
 *
 * All API boundaries are validated here — never duplicate these shapes.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Friction points that can trigger a contextual upgrade prompt.
 * Each maps to a paid power-up in the generous-free model.
 */
export const UpgradeTriggerSchema = z.enum([
  'custom_domain',
  'remove_branding',
  'more_pages',
  'ai_credits',
  'priority_build',
  'analytics_pro',
]);

export type UpgradeTrigger = z.infer<typeof UpgradeTriggerSchema>;

/** Caller plan tier — drives eligibility (paid plans remove the friction). */
export const PlanTierSchema = z.enum(['free', 'starter', 'pro']);

export type PlanTier = z.infer<typeof PlanTierSchema>;

/** Context that shapes a moment's copy + eligibility. */
export const UpgradeContextSchema = z
  .object({
    /** Caller plan tier; defaults to `free` (the friction-bearing tier). */
    plan: PlanTierSchema.default('free'),
    /** Optional business type for light copy personalization (e.g. "salon"). */
    businessType: z.string().max(64).optional(),
  })
  .strict();

export type UpgradeContext = z.infer<typeof UpgradeContextSchema>;

/** A single resolved upgrade moment. */
export const UpgradeMomentSchema = z
  .object({
    trigger: UpgradeTriggerSchema,
    /** Whether this upsell applies to the caller (false → UI hides it). */
    eligible: z.boolean(),
    /** Short, benefit-led headline (4-8 words). */
    headline: z.string().min(1),
    /** Two-sentence body explaining the value at the friction moment. */
    body: z.string().min(1),
    /** Three concrete benefits unlocked by upgrading. */
    benefits: z.array(z.string().min(1)).min(1).max(5),
    /** Button label. */
    cta_label: z.string().min(1),
    /** Deep link to the billing surface, attributed to this trigger. */
    cta_url: z.string().min(1),
    /** Human price hint, e.g. "$5/mo". Never authoritative — display only. */
    price_hint: z.string().min(1),
    /** A compelling, honest stat that motivates the upgrade. */
    value_metric: z.string().min(1),
    /** Stable key the client uses to remember a dismissal. */
    dismiss_key: z.string().min(1),
  })
  .strict();

export type UpgradeMoment = z.infer<typeof UpgradeMomentSchema>;

/** GET /api/upgrade-moments/:trigger response. */
export const UpgradeMomentResponseSchema = UpgradeMomentSchema.extend({
  /** True when the caller has previously dismissed this moment. */
  dismissed: z.boolean(),
}).strict();

export type UpgradeMomentResponse = z.infer<typeof UpgradeMomentResponseSchema>;

/** GET /api/upgrade-moments response (all eligible, non-dismissed moments). */
export const UpgradeMomentListResponseSchema = z
  .object({
    moments: z.array(UpgradeMomentSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();

export type UpgradeMomentListResponse = z.infer<typeof UpgradeMomentListResponseSchema>;

/** POST /api/upgrade-moments/:trigger/dismiss response. */
export const DismissResponseSchema = z
  .object({
    trigger: UpgradeTriggerSchema,
    dismissed: z.literal(true),
  })
  .strict();

export type DismissResponse = z.infer<typeof DismissResponseSchema>;
