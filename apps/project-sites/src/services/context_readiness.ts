/**
 * @module services/context_readiness
 *
 * @description
 * The AI context-quality READINESS GATE (axis item #3, per `_ULTIMATE_LOOP.prompt.md`
 * § AI context-quality axis). Before any AI generation fires, score whether the
 * context window is sufficiently loaded — required slots filled × retrieval hits ×
 * confidence — and BLOCK generation below threshold so the caller fetches the gaps
 * first. The doctrine: "no generation on thin context."
 *
 * @remarks
 * - PURE + TOTAL: no I/O, no clock, no network; never throws. Invalid input →
 *   `{ score: 0, ready: false, reasons: [...] }` so a caller can branch safely.
 * - Score is a 0-100 weighted blend: slots 50%, retrieval 30%, confidence 20%.
 * - `ready` requires BOTH `score >= threshold` (default 70) AND zero missing
 *   required slots — a missing slot is a hard block regardless of score.
 *
 * @example
 * ```ts
 * const r = computeContextReadiness({
 *   requiredSlots: ['brand', 'sitemap', 'competitors'],
 *   filledSlots: ['brand', 'sitemap'],
 *   retrievalHits: 8, retrievalExpected: 10, avgConfidence: 0.9,
 * });
 * if (!r.ready) await fetchMissing(r.missingSlots); // else generate
 * ```
 */
import { z } from 'zod';

/** Weighting of the three readiness axes (sums to 1). */
const SLOT_WEIGHT = 0.5;
const RETRIEVAL_WEIGHT = 0.3;
const CONFIDENCE_WEIGHT = 0.2;

/** Default minimum score (0-100) for `ready=true`. */
const DEFAULT_THRESHOLD = 70;

/** Inputs to the readiness computation. */
export const ContextReadinessInputSchema = z.object({
  /** Mean provenance confidence of the loaded facts, 0-1. */
  avgConfidence: z.number().min(0).max(1),
  /** The slots actually populated in the assembled context. */
  filledSlots: z.array(z.string()),
  /** The slots this generation REQUIRES (e.g. brand, sitemap, competitors). */
  requiredSlots: z.array(z.string()),
  /** How many were expected/targeted (0 = nothing to retrieve = satisfied). */
  retrievalExpected: z.number().int().min(0),
  /** How many retrieval results actually landed in context. */
  retrievalHits: z.number().int().min(0),
});

export type ContextReadinessInput = z.infer<typeof ContextReadinessInputSchema>;

export interface ContextReadinessOptions {
  /** Minimum score for `ready`. Default 70. */
  threshold?: number;
}

export interface ContextReadinessResult {
  /** 0-100 blended readiness score. */
  score: number;
  /** True only when score >= threshold AND no required slot is missing. */
  ready: boolean;
  /** Required slots not present in `filledSlots`. */
  missingSlots: string[];
  /** Human-readable explanations for why it is / isn't ready. */
  reasons: string[];
}

/** Round to a whole number; keeps scores stable + assertable. */
function pct(n: number): number {
  return Math.round(n * 100);
}

/**
 * Score context readiness and decide whether generation may proceed.
 *
 * @param input - Slot/retrieval/confidence snapshot of the assembled context.
 * @param opts  - Optional threshold override.
 * @returns A total, never-throwing readiness verdict.
 */
export function computeContextReadiness(
  input: ContextReadinessInput,
  opts: ContextReadinessOptions = {},
): ContextReadinessResult {
  const parsed = ContextReadinessInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      missingSlots: [],
      ready: false,
      reasons: ['invalid_input: ' + parsed.error.issues.map((i) => i.message).join('; ')],
      score: 0,
    };
  }

  const { avgConfidence, filledSlots, requiredSlots, retrievalExpected, retrievalHits } =
    parsed.data;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const filled = new Set(filledSlots);
  const missingSlots = requiredSlots.filter((s) => !filled.has(s));

  // Axis 1 — slot coverage (empty required set = fully satisfied).
  const slotRatio = requiredSlots.length === 0 ? 1 : 1 - missingSlots.length / requiredSlots.length;
  // Axis 2 — retrieval coverage (nothing expected = satisfied; clamp over-retrieval).
  const retrievalRatio =
    retrievalExpected === 0 ? 1 : Math.min(1, retrievalHits / retrievalExpected);
  // Axis 3 — provenance confidence (already 0-1).
  const score = pct(
    slotRatio * SLOT_WEIGHT + retrievalRatio * RETRIEVAL_WEIGHT + avgConfidence * CONFIDENCE_WEIGHT,
  );

  const reasons: string[] = [];
  if (missingSlots.length > 0) reasons.push(`missing required slots: ${missingSlots.join(', ')}`);
  if (retrievalRatio < 1)
    reasons.push(`retrieval under-filled: ${retrievalHits}/${retrievalExpected}`);
  if (avgConfidence < 0.6) reasons.push(`low average confidence: ${avgConfidence}`);
  if (score < threshold) reasons.push(`score ${score} below threshold ${threshold}`);
  if (reasons.length === 0) reasons.push('context fully loaded');

  const ready = score >= threshold && missingSlots.length === 0;
  return { missingSlots, ready, reasons, score };
}
