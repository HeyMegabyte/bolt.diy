/**
 * Twenty CRM lead scoring model — pure, zero-I/O scoring core.
 *
 * @remarks
 * Scores a lead company based on enrichment data signals into a tier
 * (A/B/C/D) and a 0-100 numeric score. Every function is deterministic
 * and side-effect-free — no env, no network, no throw.
 *
 * Score breakdown (0-100, clamped):
 * - hasWebsite     +20  — established online presence
 * - hasEmail       +15  — reachable via email
 * - hasPhone       +15  — reachable via phone
 * - reviews        +25  — social proof (count: 15, rating: 10)
 * - socialLinks    +15  — social media footprint (3 pts/link, capped)
 * - employees      +10  — company size indicator (range-scaled)
 *
 * Tier thresholds: A ≥ 70, B ≥ 50, C ≥ 30, D < 30.
 *
 * @example
 * ```ts
 * const result = scoreLead({
 *   hasWebsite: true,
 *   hasEmail: true,
 *   hasPhone: true,
 *   reviewCount: 42,
 *   reviewRating: 4.7,
 *   socialLinks: 5,
 *   employees: 14,
 * });
 * // { components: { email:15, employees:5, phone:15, reviews:25, social:15,
 * //   website:20 }, score: 98, tier: 'A' }
 * ```
 */

/** Enrichment data for a company being scored as a lead. */
export interface LeadInput {
  hasWebsite: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
  reviewCount: number;
  reviewRating: number;
  socialLinks: number;
  employees?: number;
}

/** Lead quality tier derived from the numeric score. */
export type LeadTier = 'A' | 'B' | 'C' | 'D';

/** Result of a lead score evaluation. */
export interface LeadScore {
  /** Quality tier: A ≥ 70, B ≥ 50, C ≥ 30, D < 30. */
  tier: LeadTier;
  /** Aggregate 0-100 score (integer, clamped). */
  score: number;
  /** Per-signal breakdown for transparency. */
  components: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clampScore = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** Review-count score, out of 15. */
function reviewCountScore(count: number): number {
  if (count <= 0) return 0;
  if (count <= 5) return 5;
  if (count <= 25) return 10;
  return 15;
}

/** Review-rating score, out of 10. */
function reviewRatingScore(rating: number): number {
  if (rating <= 0) return 0;
  if (rating < 3.5) return 2;
  if (rating < 4.0) return 5;
  if (rating < 4.5) return 8;
  return 10;
}

/** Employee-based score, out of 10, scaled by company-size ranges. */
function employeeScore(employees?: number): number {
  if (employees == null || employees <= 0) return 0;
  if (employees <= 5) return 3;
  if (employees <= 25) return 5;
  if (employees <= 100) return 8;
  return 10;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score a lead company on enrichment data.
 *
 * @param input - The {@link LeadInput} enrichment record.
 * @returns A {@link LeadScore} with tier, score, and per-component breakdown.
 *
 * @remarks Impure — no side-effects, network, or I/O. Always safe to call.
 */
export function scoreLead(input: LeadInput): LeadScore {
  const website = input.hasWebsite ? 20 : 0;
  const email = input.hasEmail ? 15 : 0;
  const phone = input.hasPhone ? 15 : 0;
  const reviewsReviewCount = reviewCountScore(input.reviewCount);
  const reviewsRating = reviewRatingScore(input.reviewRating);
  const reviews = Math.min(25, reviewsReviewCount + reviewsRating);
  const social = Math.min(15, Math.max(0, Math.round(input.socialLinks * 3)));
  const employees = employeeScore(input.employees);

  const total = clampScore(website + email + phone + reviews + social + employees);

  const tier: LeadTier = total >= 70 ? 'A' : total >= 50 ? 'B' : total >= 30 ? 'C' : 'D';

  return {
    components: { email, employees, phone, reviews, social, website },
    score: total,
    tier,
  };
}
