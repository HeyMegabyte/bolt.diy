/**
 * @module services/abandoned_builds
 * @description Pure eligibility logic for the abandoned-build recovery nudge (#27).
 *
 * A build that FINISHED but was never claimed (no active subscription) is a lost
 * conversion. A scheduled scan emails the owner a one-time nudge with the preview
 * link. This module owns ONLY the pure "which builds are eligible right now?"
 * decision — the D1 scan, email send, and `nudged_at` write are the I/O wrapper
 * that calls `selectAbandonedBuilds`. Pure + fully testable: same inputs → same
 * output, no I/O.
 *
 * Eligibility (ALL must hold):
 *  - the build FINISHED (status in the finished set), and
 *  - it is NOT claimed (no active subscription / claim), and
 *  - its age is inside the nudge window `[minAgeMs, maxAgeMs]` (wait long enough
 *    that the owner truly didn't return; stop nudging stale builds), and
 *  - it was never nudged, OR the last nudge was longer ago than `reNudgeMs`
 *    (throttle — never spam the same owner).
 */

/** A finished-build row the scan feeds in (shape mirrors the D1 projection). */
export interface BuildRow {
  readonly siteId: string;
  readonly orgId: string;
  /** Lifecycle status, e.g. 'published' | 'finished' | 'generating' | 'error'. */
  readonly status: string;
  /** When the build finished, epoch ms. */
  readonly finishedAtMs: number;
  /** True when the org has claimed/paid (active subscription) — never nudge these. */
  readonly claimed: boolean;
  /** Epoch ms of the last recovery nudge, or null if never nudged. */
  readonly nudgedAtMs: number | null;
}

/** Tunables for the nudge window + throttle. */
export interface AbandonedOptions {
  /** Minimum age before a build is "abandoned" (default 24h). */
  readonly minAgeMs?: number;
  /** Maximum age past which we stop nudging (default 14d). */
  readonly maxAgeMs?: number;
  /** Minimum gap between nudges to the same build (default 7d). */
  readonly reNudgeMs?: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const DEFAULTS = { minAgeMs: 24 * HOUR, maxAgeMs: 14 * DAY, reNudgeMs: 7 * DAY } as const;

/** Statuses that count as a finished build eligible for a recovery nudge. */
export const FINISHED_STATUSES: ReadonlySet<string> = new Set(['published', 'finished', 'complete']);

/**
 * Select the builds eligible for an abandoned-build recovery nudge right now.
 *
 * @param rows - Candidate finished-build rows (the scan's D1 projection).
 * @param nowMs - Current epoch ms (injected so the function stays pure/testable).
 * @param opts - Window + throttle overrides.
 * @returns The subset of `rows` to nudge this run (input order preserved).
 * @example
 * selectAbandonedBuilds(rows, Date.now()); // → rows finished 1–14d ago, unclaimed, not recently nudged
 */
export function selectAbandonedBuilds(
  rows: readonly BuildRow[],
  nowMs: number,
  opts: AbandonedOptions = {},
): BuildRow[] {
  const minAgeMs = opts.minAgeMs ?? DEFAULTS.minAgeMs;
  const maxAgeMs = opts.maxAgeMs ?? DEFAULTS.maxAgeMs;
  const reNudgeMs = opts.reNudgeMs ?? DEFAULTS.reNudgeMs;

  return rows.filter((r) => {
    if (r.claimed) return false; // converted — never nudge
    if (!FINISHED_STATUSES.has(r.status)) return false; // not a finished build
    const age = nowMs - r.finishedAtMs;
    if (age < minAgeMs || age > maxAgeMs) return false; // outside the nudge window
    if (r.nudgedAtMs !== null && nowMs - r.nudgedAtMs < reNudgeMs) return false; // throttle
    return true;
  });
}
