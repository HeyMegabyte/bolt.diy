/**
 * @module libs/features/gbp_assist/schemas
 * @description Zod schemas for the Google Business Profile (GBP) Assist feature
 * module (idea #9). Single source of truth per [[zod-everywhere]] — the service
 * + handlers infer every type from here, never hand-maintained.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** GBP description hard limit (Google enforces 750 chars). */
export const GBP_DESCRIPTION_MAX = 750;

/**
 * Detected GBP status for a site. `hasProfile` drives the UI between a
 * "claim/optimize" path and a "create" path; the deep-link routes the owner to
 * the right Google console screen.
 */
export const GbpStatusSchema = z
  .object({
    hasProfile: z.boolean(),
    placeId: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    rating: z.number().min(0).max(5).optional(),
    reviewCount: z.number().int().nonnegative().optional(),
    /** Deep-link to claim/manage an existing profile, or create a new one. */
    deepLink: z.string().url(),
  })
  .strict();

export type GbpStatus = z.infer<typeof GbpStatusSchema>;

/**
 * SEO-optimized content the owner pastes into the GBP console. The
 * `description` is clamped to {@link GBP_DESCRIPTION_MAX} so it never exceeds
 * Google's limit even if the LLM over-produces.
 */
export const GbpContentPackSchema = z
  .object({
    primaryCategory: z.string().min(1),
    secondaryCategories: z.array(z.string().min(1)).max(9).default([]),
    description: z.string().min(1).max(GBP_DESCRIPTION_MAX),
    services: z.array(z.string().min(1)).default([]),
    attributes: z.array(z.string().min(1)).default([]),
    firstPost: z.string().min(1),
  })
  .strict();

export type GbpContentPack = z.infer<typeof GbpContentPackSchema>;

/** One guided setup step with its done-state. */
export const GbpChecklistStepSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    done: z.boolean(),
  })
  .strict();

export type GbpChecklistStep = z.infer<typeof GbpChecklistStepSchema>;

/** Ordered guided checklist response for `GET …/gbp/checklist`. */
export const GbpChecklistResponseSchema = z
  .object({
    siteId: z.string().min(1),
    steps: z.array(GbpChecklistStepSchema),
  })
  .strict();

export type GbpChecklistResponse = z.infer<typeof GbpChecklistResponseSchema>;

/** Schema the LLM is asked to fill (structured output) before clamping. */
export const GbpContentPackDraftSchema = z
  .object({
    primaryCategory: z.string().min(1),
    secondaryCategories: z.array(z.string()).default([]),
    description: z.string().min(1),
    services: z.array(z.string()).default([]),
    attributes: z.array(z.string()).default([]),
    firstPost: z.string().min(1),
  })
  .passthrough();

export type GbpContentPackDraft = z.infer<typeof GbpContentPackDraftSchema>;
