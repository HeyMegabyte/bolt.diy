/**
 * @module services/activation_scoring
 * @description LOOP-ANALYTICS-009 core — computes a per-org activation score
 * (0–100) from weighted milestone events. Pure function, zero I/O.
 *
 * Drives onboarding checklists, lifecycle emails, and churn prediction.
 * Milestones are weighted by significance; the score is the sum of weights
 * for completed milestones divided by the total possible weight, scaled to
 * 0–100.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Milestone taxonomy ─────────────────────────────────────────────────────

/** Well-known activation milestones. */
export const ActivationMilestone = z.enum([
  'signed_up',
  'verified_email',
  'created_first_site',
  'published_first_site',
  'claimed_custom_domain',
  'invited_teammate',
  'connected_social',
  'viewed_analytics',
  'started_checkout',
  'completed_checkout',
  'received_first_lead',
  'shared_site',
]);
export type ActivationMilestone = z.infer<typeof ActivationMilestone>;

// ── Milestone weights ──────────────────────────────────────────────────────

/**
 * Weight per milestone. Sum of all weights = 100 so the score is naturally
 * bounded 0–100 when all milestones are hit.
 */
export const MILESTONE_WEIGHTS: Record<ActivationMilestone, number> = {
  signed_up: 5,
  verified_email: 5,
  created_first_site: 15,
  published_first_site: 20,
  claimed_custom_domain: 15,
  invited_teammate: 10,
  connected_social: 5,
  viewed_analytics: 5,
  started_checkout: 5,
  completed_checkout: 10,
  received_first_lead: 3,
  shared_site: 2,
};

/** Total possible weight — used as the denominator for percentage scaling. */
const TOTAL_WEIGHT = Object.values(MILESTONE_WEIGHTS).reduce((a, b) => a + b, 0);

// ── Activation level ───────────────────────────────────────────────────────

export const ActivationLevel = z.enum(['cold', 'warming', 'engaged', 'activated', 'power']);
export type ActivationLevel = z.infer<typeof ActivationLevel>;

// ── Output ─────────────────────────────────────────────────────────────────

/** The result of one activation-score computation. */
export const ActivationScoreResultSchema = z.object({
  /** 0–100 score. */
  score: z.number().int().min(0).max(100),
  /** Human-readable activation band. */
  level: ActivationLevel,
  /** Milestones already achieved. */
  completed: z.array(z.string()),
  /** Milestones not yet achieved, ordered by weight descending. */
  remaining: z.array(z.string()),
  /**
   * The single highest-impact next milestone — the one the onboarding
   * checklist should steer the user toward.
   */
  nextBestAction: z.string().nullable(),
});
export type ActivationScoreResult = z.infer<typeof ActivationScoreResultSchema>;

// ── Compute ────────────────────────────────────────────────────────────────

/**
 * Computes an activation score (0–100) from a set of completed milestones.
 * Pure — same milestones always produce the same score.
 *
 * The score is `sum(weights of completed) / totalWeight * 100`, rounded to
 * the nearest integer and clamped to 0–100.
 *
 * @param completed - Array of milestone keys the org has achieved.
 *   Duplicates are tolerated (deduped internally).
 * @returns Scored, leveled, and explained result.
 *
 * @example
 * ```ts
 * const result = computeActivationScore(['signed_up', 'verified_email', 'created_first_site']);
 * // { score: 25, level: 'warming', completed: [...], remaining: [...], nextBestAction: 'published_first_site' }
 * ```
 */
export function computeActivationScore(completed: readonly string[]): ActivationScoreResult {
  // Dedupe + validate
  const unique = [...new Set(completed)].filter((m): m is ActivationMilestone => {
    const result = ActivationMilestone.safeParse(m);
    return result.success;
  });

  // Sum completed weights
  const completedWeight = unique.reduce((sum, m) => sum + MILESTONE_WEIGHTS[m], 0);

  // Score as percentage of total
  const raw = (completedWeight / TOTAL_WEIGHT) * 100;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // Level
  const level = classifyActivationLevel(score);

  // Remaining milestones (not completed), sorted by weight descending
  const allMilestones = Object.keys(MILESTONE_WEIGHTS) as ActivationMilestone[];
  const remaining = allMilestones
    .filter((m) => !unique.includes(m))
    .sort((a, b) => MILESTONE_WEIGHTS[b] - MILESTONE_WEIGHTS[a]);

  // Next best action = highest-weight remaining milestone
  const nextBestAction = remaining.length > 0 ? remaining[0] : null;

  return ActivationScoreResultSchema.parse({
    score,
    level,
    completed: unique,
    remaining,
    nextBestAction,
  });
}

/**
 * Classifies a 0–100 activation score into a human-readable level.
 *
 * - 0–14 → `cold`
 * - 15–39 → `warming`
 * - 40–69 → `engaged`
 * - 70–89 → `activated`
 * - 90–100 → `power`
 *
 * @param score - Activation score (0–100).
 * @returns Activation level band.
 */
export function classifyActivationLevel(score: number): ActivationLevel {
  if (score >= 90) return 'power';
  if (score >= 70) return 'activated';
  if (score >= 40) return 'engaged';
  if (score >= 15) return 'warming';
  return 'cold';
}
