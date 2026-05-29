/**
 * @module libs/features/review_synthesis/schemas
 * @description Zod schemas for the Review Synthesis feature (idea #24).
 *
 * Source of truth for the runtime shapes the synthesis service produces:
 *   - {@link VerifiedReviewSchema} — a single review that passed origin verification
 *   - {@link ReviewAggregateSchema} — schema.org-shaped aggregate rating
 *   - {@link ReviewSynthesisSchema} — the persisted synthesis record
 *   - {@link ReviewJsonLdSchema} — the emitted JSON-LD block (AggregateRating + Review[])
 *
 * Honesty gate: only reviews tagged `verified: true` with a known `source`
 * are ever persisted or surfaced. Fabricated / empty-author / out-of-range
 * reviews are rejected upstream and never reach these schemas.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Allowed origins for a verified review. Extend deliberately — never widen to "manual". */
export const ReviewSourceSchema = z.enum(['google_places']);
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

/**
 * A single review that survived origin verification.
 *
 * @remarks
 * `verified` is always `true` here by construction — the field exists so the
 * persisted/emitted payload self-documents provenance to downstream consumers.
 */
export const VerifiedReviewSchema = z.object({
  /** Review body text (trimmed, non-empty). */
  text: z.string().min(1),
  /** Author display name (non-empty — anonymous/empty authors are rejected). */
  author: z.string().min(1),
  /** Star rating, integer-ish 1-5. */
  rating: z.number().min(1).max(5),
  /** Human-relative time string from the source (e.g. "2 weeks ago"). */
  time: z.string(),
  /** Always true — only verified reviews are constructed. */
  verified: z.literal(true),
  /** Provenance tag. */
  source: ReviewSourceSchema,
});
export type VerifiedReview = z.infer<typeof VerifiedReviewSchema>;

/** Aggregate rating computed from verified reviews only. */
export const ReviewAggregateSchema = z.object({
  ratingValue: z.number().min(0).max(5),
  reviewCount: z.number().int().min(0),
});
export type ReviewAggregate = z.infer<typeof ReviewAggregateSchema>;

/** The persisted synthesis record (mirrors the `review_syntheses` D1 row). */
export const ReviewSynthesisSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  orgId: z.string().nullable(),
  /** AI-generated 40-60 word trust paragraph. Empty string when no verified reviews. */
  summary: z.string(),
  /** Top 3 featured verified quotes. */
  featured: z.array(VerifiedReviewSchema).max(3),
  aggregate: ReviewAggregateSchema,
  source: ReviewSourceSchema,
  aiModel: z.string().nullable(),
  createdAt: z.string(),
});
export type ReviewSynthesis = z.infer<typeof ReviewSynthesisSchema>;

/** schema.org Review object (subset we emit). */
export const ReviewJsonLdReviewSchema = z.object({
  '@type': z.literal('Review'),
  author: z.object({ '@type': z.literal('Person'), name: z.string() }),
  reviewRating: z.object({
    '@type': z.literal('Rating'),
    ratingValue: z.number(),
    bestRating: z.literal(5),
    worstRating: z.literal(1),
  }),
  reviewBody: z.string(),
});
export type ReviewJsonLdReview = z.infer<typeof ReviewJsonLdReviewSchema>;

/** schema.org AggregateRating + Review[] JSON-LD block. */
export const ReviewJsonLdSchema = z.object({
  '@context': z.literal('https://schema.org'),
  '@type': z.literal('Product'),
  name: z.string(),
  aggregateRating: z.object({
    '@type': z.literal('AggregateRating'),
    ratingValue: z.number(),
    reviewCount: z.number().int(),
    bestRating: z.literal(5),
    worstRating: z.literal(1),
  }),
  review: z.array(ReviewJsonLdReviewSchema),
});
export type ReviewJsonLd = z.infer<typeof ReviewJsonLdSchema>;
