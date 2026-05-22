/**
 * @module constants/pricing
 * @description Usage-based pricing tiers and overage rates (item #99).
 *
 * Three metered metrics:
 * - `ai_calls` — every `env.AI.run` invocation
 * - `bytes_egress` — bytes shipped from `/api/sites/{id}/serve` (response body)
 * - `image_generations` — every successful DALL·E / Stability / Ideogram call
 *
 * @packageDocumentation
 */

/**
 * Per-tier monthly inclusions and overage rates.
 *
 * @remarks
 * Free is hard-capped at the inclusion (over-quota requests get 402).
 * Pro and Scale meter overages and charge `OVERAGE_*` per unit via Stripe
 * `subscriptionItems.createUsageRecord`.
 *
 * @example
 * ```ts
 * import { USAGE_TIERS } from '../constants/pricing.js';
 * const tier = USAGE_TIERS.pro;
 * if (currentAiCalls > tier.ai_calls) {
 *   // bill overage
 * }
 * ```
 */
export const USAGE_TIERS = {
  free: {
    label: 'Free',
    monthly_cents: 0,
    ai_calls: 1_000,
    bytes_egress: 1024 * 1024 * 1024, // 1 GB
    image_generations: 50,
  },
  pro: {
    label: 'Pro',
    monthly_cents: 2_900,
    ai_calls: 50_000,
    bytes_egress: 100 * 1024 * 1024 * 1024, // 100 GB
    image_generations: 2_000,
  },
  scale: {
    label: 'Scale',
    monthly_cents: 9_900,
    ai_calls: 500_000,
    bytes_egress: 1024 * 1024 * 1024 * 1024, // 1 TB
    image_generations: 20_000,
  },
} as const;

/** Tier name union. */
export type UsageTier = keyof typeof USAGE_TIERS;

/**
 * Overage rates expressed in micro-USD per unit (1 USD = 1_000_000 micro-USD).
 * Stored as integers so Stripe usage records (which take whole quantities)
 * can multiply without floating-point drift.
 *
 * - $0.0005 per `ai_call`   → 500 micro-USD
 * - $0.05   per GB egress   → 50_000 micro-USD per GB
 * - $0.05   per `image_gen` → 50_000 micro-USD
 */
export const OVERAGE_MICRO_USD = {
  ai_calls: 500,
  bytes_egress_per_gb: 50_000,
  image_generations: 50_000,
} as const;

/** Metered metric name union. */
export type UsageMetric = 'ai_calls' | 'bytes_egress' | 'image_generations';

/** All metered metric names — useful for iteration. */
export const USAGE_METRICS: readonly UsageMetric[] = [
  'ai_calls',
  'bytes_egress',
  'image_generations',
] as const;
