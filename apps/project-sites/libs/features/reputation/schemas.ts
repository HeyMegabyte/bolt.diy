/**
 * @module libs/features/reputation/schemas
 * @description Zod schemas for the Reputation suite (ideas #10, #11, #13).
 *
 * Source of truth for the runtime shapes the service produces/consumes:
 *   - {@link ReviewRequestSchema}     — a sent review-ask record (#10)
 *   - {@link ReviewReplyDraftSchema}  — an AI on-brand reply draft (#11)
 *   - {@link MonitoredPlatformSchema} — a tracked external review platform (#13)
 *   - {@link CachedReviewSchema}      — a normalized cached review row (#13)
 *   - {@link ReputationSnapshotSchema}— the aggregate monitor response (#13)
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/** Channels a review request can go out on (#10). */
export const ReviewRequestChannelSchema = z.enum(['email', 'sms']);
export type ReviewRequestChannel = z.infer<typeof ReviewRequestChannelSchema>;

/** Delivery outcome of a sent request (#10). */
export const ReviewRequestStatusSchema = z.enum(['sent', 'failed']);
export type ReviewRequestStatus = z.infer<typeof ReviewRequestStatusSchema>;

/** Known external review platforms (#13). Extend deliberately. */
export const ReputationPlatformSchema = z.enum([
  'google',
  'yelp',
  'facebook',
  'tripadvisor',
]);
export type ReputationPlatform = z.infer<typeof ReputationPlatformSchema>;

/**
 * A persisted review-request record (mirrors a `review_requests` D1 row).
 *
 * @remarks `message` is the LLM-personalized ask actually delivered; `link` is
 * the Google review deep-link embedded in it.
 */
export const ReviewRequestSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  orgId: z.string().nullable(),
  channel: ReviewRequestChannelSchema,
  /** Email address or E.164 phone the ask was sent to. */
  recipient: z.string().min(1),
  /** The personalized ask body that was delivered. */
  message: z.string().min(1),
  /** Google review deep-link surfaced in the ask. */
  link: z.string().url(),
  status: ReviewRequestStatusSchema,
  createdAt: z.string(),
});
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

/** An AI-generated on-brand reply draft to a single review (#11). */
export const ReviewReplyDraftSchema = z.object({
  siteId: z.string(),
  /** The original review text the draft responds to. */
  reviewText: z.string().min(1),
  /** Star rating of the original review (1-5). */
  rating: z.number().min(1).max(5),
  /** Requested tone (e.g. "warm", "professional"). */
  tone: z.string(),
  /** The drafted reply — best-effort, never auto-published. */
  draft: z.string().min(1),
  /** Model that produced the draft, or null when generation failed. */
  aiModel: z.string().nullable(),
});
export type ReviewReplyDraft = z.infer<typeof ReviewReplyDraftSchema>;

/** A tracked external review platform (mirrors a `reputation_platforms` row) (#13). */
export const MonitoredPlatformSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  orgId: z.string().nullable(),
  platform: ReputationPlatformSchema,
  /** Platform-side profile/listing URL. */
  profileUrl: z.string().url().nullable(),
  /** Last-synced average rating, 0-5. */
  rating: z.number().min(0).max(5).nullable(),
  /** Last-synced total review count. */
  reviewCount: z.number().int().min(0).nullable(),
  createdAt: z.string(),
});
export type MonitoredPlatform = z.infer<typeof MonitoredPlatformSchema>;

/** A normalized cached review (mirrors a `reputation_reviews_cache` row) (#13). */
export const CachedReviewSchema = z.object({
  platform: ReputationPlatformSchema,
  text: z.string(),
  author: z.string(),
  rating: z.number().min(1).max(5),
  /** Human-relative or ISO time string from the source. */
  time: z.string(),
});
export type CachedReview = z.infer<typeof CachedReviewSchema>;

/** Per-platform rollup inside a snapshot (#13). */
export const PlatformSnapshotSchema = z.object({
  platform: ReputationPlatformSchema,
  rating: z.number().min(0).max(5),
  reviewCount: z.number().int().min(0),
});
export type PlatformSnapshot = z.infer<typeof PlatformSnapshotSchema>;

/**
 * Aggregate reputation snapshot across all monitored platforms (#13).
 *
 * @remarks `needsAttention` flips true when the weighted average drops below
 * 4.5 stars OR the total review count is under 20 (BrightLocal trust
 * thresholds — consumers below these convert measurably worse).
 */
export const ReputationSnapshotSchema = z.object({
  siteId: z.string(),
  /** Weighted average rating across platforms, 0-5. */
  averageRating: z.number().min(0).max(5),
  /** Total review count across platforms. */
  totalReviews: z.number().int().min(0),
  platforms: z.array(PlatformSnapshotSchema),
  /** Most-recent reviews across platforms (newest-first, capped). */
  recent: z.array(CachedReviewSchema),
  /** True when avg < 4.5 OR count < 20 (BrightLocal thresholds). */
  needsAttention: z.boolean(),
});
export type ReputationSnapshot = z.infer<typeof ReputationSnapshotSchema>;
