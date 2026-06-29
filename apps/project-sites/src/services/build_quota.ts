/**
 * @module services/build_quota
 *
 * Pure build-quota checking for the site-generation pipeline. Each quota tracks a
 * countable resource (monthly builds, concurrent builds, build-minutes), how much
 * has been used in the current period, and when the period resets. No I/O, no
 * clock-side-effects — the caller supplies `nowMs` or defaults to `Date.now()`.
 *
 * PLan-constant table is the single source of truth; the DB holds actual `used`
 * and `periodStartMs` per org.
 */

/** The countable resource types the pipeline gates on. */
export type BuildQuotaType = 'monthly_builds' | 'concurrent_builds' | 'build_minutes';

/** A single quota snapshot. `periodStartMs` is epoch ms of the billing-period start. */
export interface BuildQuota {
  type: BuildQuotaType;
  limit: number;
  used: number;
  periodStartMs: number;
}

/** Result of a single-quota check. */
export interface BuildQuotaCheck {
  exceeded: boolean;
  remaining: number;
  resetsInMs: number;
}

/** Aggregate result across all quotas. */
export interface BuildQuotaSummary {
  canBuild: boolean;
  blockers: string[];
}

/**
 * Plan-level quota limits per resource.
 *
 * @example
 * ```ts
 * PLAN_QUOTAS['free'] // { monthly_builds: 5, concurrent_builds: 1, build_minutes: 15 }
 * ```
 */
export const PLAN_QUOTAS: Record<
  string,
  { build_minutes: number; concurrent_builds: number; monthly_builds: number }
> = {
  free: { build_minutes: 15, concurrent_builds: 1, monthly_builds: 5 },
  pro: { build_minutes: 300, concurrent_builds: 5, monthly_builds: 500 },
  starter: { build_minutes: 60, concurrent_builds: 2, monthly_builds: 50 },
};

/**
 * Check a single quota against its limit. Pure — no I/O, no clock mutation.
 *
 * @param quota  - The quota snapshot to evaluate.
 * @param nowMs  - Current epoch ms (defaults to `Date.now()`).
 * @returns `{ exceeded, remaining, resetsInMs }`
 *
 * @example
 * ```ts
 * const r = checkBuildQuota({ type:'monthly_builds', limit:5, used:4, periodStartMs:1717200000000 });
 * // { exceeded: false, remaining: 1, resetsInMs: ... }
 * ```
 *
 * @throws Never. Edge values (negative used/limit) are clamped to 0.
 */
export function checkBuildQuota(quota: BuildQuota, nowMs?: number): BuildQuotaCheck {
  const now = nowMs ?? Date.now();
  const limit = Math.max(0, quota.limit);
  const used = Math.max(0, quota.used);
  const remaining = Math.max(0, limit - used);
  const exceeded = limit > 0 && used >= limit;
  const resetsInMs = Math.max(0, quota.periodStartMs + 30 * 24 * 60 * 60 * 1000 - now);

  return { exceeded, remaining, resetsInMs };
}

/**
 * Summarise a set of quotas into a single build-go / no-go with human-readable
 * blocker messages. A single exceeded quota blocks the whole build.
 *
 * @param quotas - The list of active quotas to evaluate.
 * @returns `{ canBuild, blockers }` — `blockers` is empty when `canBuild` is true.
 *
 * @example
 * ```ts
 * const s = buildQuotaSummary([
 *   { type:'monthly_builds',  limit:5,  used:5, periodStartMs:1000 },
 *   { type:'concurrent_builds', limit:1, used:0, periodStartMs:1000 },
 * ]);
 * // { canBuild: false, blockers: ['monthly_builds: limit 5 reached'] }
 * ```
 */
export function buildQuotaSummary(quotas: readonly BuildQuota[]): BuildQuotaSummary {
  const blockers: string[] = [];

  for (const q of quotas) {
    const check = checkBuildQuota(q);
    if (check.exceeded) {
      blockers.push(`${q.type}: limit ${q.limit} reached`);
    }
  }

  return { blockers, canBuild: blockers.length === 0 };
}
