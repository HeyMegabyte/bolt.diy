/**
 * @module libs/features/comparison_pages/schemas
 * @description Zod schemas for Comparison + Alternative Pages Engine (idea #31).
 *
 * @packageDocumentation
 */

import { z } from 'zod';

export const PricingPlanSchema = z.object({
  name: z.string().min(1).max(60),
  priceUsd: z.number().nonnegative(),
  period: z.enum(['month', 'year', 'one-time']).default('month'),
  notes: z.string().max(200).optional(),
});
export type PricingPlan = z.infer<typeof PricingPlanSchema>;

export const CompetitorSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(80),
  homepageUrl: z.string().url().optional(),
  pricingUrl: z.string().url().optional(),
  pricingPlans: z.array(PricingPlanSchema).optional(),
  featuresJson: z.record(z.string(), z.boolean()).optional(),
});
export type Competitor = z.infer<typeof CompetitorSchema>;

export const CompetitorSeedRequestSchema = z.object({
  competitors: z.array(CompetitorSchema).min(1).max(20),
});

export const ComparisonGenerateRequestSchema = z.object({
  competitorSlugs: z.array(z.string()).min(1).max(20),
  kinds: z.array(z.enum(['vs', 'alternatives'])).min(1).default(['vs', 'alternatives']),
});
export type ComparisonGenerateRequest = z.infer<typeof ComparisonGenerateRequestSchema>;

export const RefreshPricingRequestSchema = z.object({
  competitorSlugs: z.array(z.string()).max(20).optional(),
});

export function comparisonRouteSlug(competitor: string, kind: 'vs' | 'alternatives'): string {
  return kind === 'vs' ? `/vs/${competitor}` : `/alternatives/${competitor}`;
}
