/**
 * @module services/impact_triage
 * @description LOOP-TRACES-021 core — scores platform errors by customer
 * impact for triage prioritization. Pure functions, zero I/O.
 *
 * Computes an impact score (0–100) from error attributes: affected user
 * count, error frequency, revenue surface, and service criticality. The
 * score drives incident priority (P0–P4) and alert routing.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

// ── Input signals ──────────────────────────────────────────────────────────

/** Signals observed for a platform error. */
export const ErrorSignalsSchema = z.object({
  /** Number of distinct users affected in the current window. */
  affectedUsers: z.number().int().nonnegative().default(0),
  /** Error occurrence count in the window. */
  occurrenceCount: z.number().int().nonnegative().default(1),
  /** Whether the error touches a billing/payment/revenue surface. */
  isRevenueSurface: z.boolean().default(false),
  /** Whether the error is on a critical service (auth, api, db, billing). */
  isCriticalService: z.boolean().default(false),
  /** Whether the error blocks a core user action (can't sign in, build, publish). */
  isBlocker: z.boolean().default(false),
  /** Error rate as a fraction of total requests (0–1). */
  errorRate: z.number().min(0).max(1).default(0),
});
export type ErrorSignals = z.infer<typeof ErrorSignalsSchema>;

// ── Impact level ───────────────────────────────────────────────────────────

export const ImpactLevel = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export type ImpactLevel = z.infer<typeof ImpactLevel>;

// ── Incident priority ──────────────────────────────────────────────────────

export const IncidentPriority = z.enum(['P4', 'P3', 'P2', 'P1', 'P0']);
export type IncidentPriority = z.infer<typeof IncidentPriority>;

// ── Output ─────────────────────────────────────────────────────────────────

export const TriageResultSchema = z.object({
  /** 0–100 impact score. */
  score: z.number().int().min(0).max(100),
  /** Human-readable impact band. */
  level: ImpactLevel,
  /** Recommended incident priority. */
  priority: IncidentPriority,
  /** Top contributing factors, ordered most-significant-first. */
  factors: z.array(z.string()),
  /** Whether this should trigger an immediate alert (P0/P1). */
  alertNow: z.boolean(),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

// ── Scoring rules ──────────────────────────────────────────────────────────

interface Factor {
  points: number;
  label: string;
}

/**
 * Computes an impact score (0–100) from error signals. Pure — same signals
 * always produce the same score.
 *
 * Rules (additive, capped at 100):
 * - Blocker (can't sign in / build / publish) → +35
 * - Revenue surface affected → +25
 * - Critical service down → +20
 * - ≥50 affected users → +20
 * - ≥10 affected users → +10
 * - Error rate ≥5% → +15
 * - Error rate ≥1% → +8
 * - High occurrence (≥100) → +10
 *
 * @param signals - Observed error signals.
 * @returns Scored, leveled, and prioritized triage result.
 *
 * @example
 * ```ts
 * const result = triageError({ affectedUsers: 75, occurrenceCount: 200, isBlocker: true, isRevenueSurface: true, errorRate: 0.08 });
 * // { score: 100, level: 'critical', priority: 'P0', alertNow: true, factors: [...] }
 * ```
 */
export function triageError(signals: ErrorSignals): TriageResult {
  const parsed = ErrorSignalsSchema.parse(signals);
  const factors: Factor[] = [];

  // Blocker — can't use the product (highest weight)
  if (parsed.isBlocker) {
    factors.push({ points: 35, label: 'Blocker: users cannot complete core action' });
  }

  // Revenue surface
  if (parsed.isRevenueSurface) {
    factors.push({ points: 25, label: 'Revenue surface affected' });
  }

  // Critical service
  if (parsed.isCriticalService) {
    factors.push({ points: 20, label: 'Critical service affected' });
  }

  // User count
  if (parsed.affectedUsers >= 50) {
    factors.push({ points: 20, label: `${parsed.affectedUsers} users affected (≥50)` });
  } else if (parsed.affectedUsers >= 10) {
    factors.push({ points: 10, label: `${parsed.affectedUsers} users affected (≥10)` });
  } else if (parsed.affectedUsers > 0) {
    factors.push({ points: 3, label: `${parsed.affectedUsers} user(s) affected` });
  }

  // Error rate
  if (parsed.errorRate >= 0.05) {
    factors.push({ points: 15, label: `Error rate ${(parsed.errorRate * 100).toFixed(1)}% (≥5%)` });
  } else if (parsed.errorRate >= 0.01) {
    factors.push({ points: 8, label: `Error rate ${(parsed.errorRate * 100).toFixed(1)}% (≥1%)` });
  }

  // Occurrence count
  if (parsed.occurrenceCount >= 100) {
    factors.push({ points: 10, label: `${parsed.occurrenceCount} occurrences (≥100)` });
  } else if (parsed.occurrenceCount >= 10) {
    factors.push({ points: 5, label: `${parsed.occurrenceCount} occurrences (≥10)` });
  }

  // Compute score
  const rawScore = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.min(100, rawScore);
  const level = classifyImpactLevel(score);
  const priority = priorityForScore(score);

  return TriageResultSchema.parse({
    score,
    level,
    priority,
    factors: factors.sort((a, b) => b.points - a.points).map((f) => f.label),
    alertNow: priority === 'P0' || priority === 'P1',
  });
}

/**
 * Classifies impact level from score.
 * 0 → none, 1–19 → low, 20–49 → medium, 50–74 → high, 75–100 → critical
 */
export function classifyImpactLevel(score: number): ImpactLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 20) return 'medium';
  if (score >= 1) return 'low';
  return 'none';
}

/**
 * Maps impact score to incident priority.
 * P0≥75, P1≥50, P2≥20, P3≥1, P4=0
 */
export function priorityForScore(score: number): IncidentPriority {
  if (score >= 75) return 'P0';
  if (score >= 50) return 'P1';
  if (score >= 20) return 'P2';
  if (score >= 1) return 'P3';
  return 'P4';
}
