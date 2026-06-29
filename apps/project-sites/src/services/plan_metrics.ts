/**
 * @module services/plan_metrics
 * @description Pure aggregation of per-plan metric snapshots for billing and
 * analytics dashboards.
 *
 * Takes an array of {@link PlanMetric} records — one row per plan tier —
 * and produces rollups: plan-keyed aggregates, total site count, most popular
 * plan by site count, and a percentage distribution of sites across plans.
 * Zero side-effects — safe to call from cron, API handlers, or tests without
 * mocking.
 *
 * ## Metric shape
 *
 * Every `PlanMetric` represents one plan tier's aggregated snapshot:
 *
 * | Field            | Description                               |
 * | ---------------- | ----------------------------------------- |
 * | `plan`           | Plan tier slug (e.g. `"starter"`)           |
 * | `siteCount`      | Sites on this plan                        |
 * | `totalVisitors`  | Total unique visitors across these sites   |
 * | `totalConversions` | Total conversions across these sites     |
 * | `avgScore`       | Average quality/health score for this plan |
 */

/** A single plan tier's aggregated metrics snapshot. */
export interface PlanMetric {
  /** Plan tier slug (e.g. `"starter"`, `"pro"`, `"enterprise"`). */
  readonly plan: string;
  /** Number of sites currently on this plan. */
  readonly siteCount: number;
  /** Total unique visitors (lifetime) across all sites on this plan. */
  readonly totalVisitors: number;
  /** Total conversions (lifetime) across all sites on this plan. */
  readonly totalConversions: number;
  /** Average quality / health score for this plan (0-100 scale). */
  readonly avgScore: number;
}

/** Per-plan rollup plus aggregate summary. */
export interface AggregateResult {
  /** Metric snapshots keyed by plan slug. */
  readonly byPlan: Record<string, PlanMetric>;
  /** Sum of `siteCount` across all plans. */
  readonly totalSites: number;
  /** Plan slug with the highest `siteCount`. When empty input or tie, the
   *  first plan with the maximum count. Empty string when metrics is empty. */
  readonly mostPopular: string;
}

/**
 * Roll up per-plan metric snapshots into a plan-keyed dictionary plus
 * aggregate totals.
 *
 * Groups input records by `plan`, sums `siteCount` / `totalVisitors` /
 * `totalConversions`, and averages `avgScore`. Returns the plan with the
 * highest site count as `mostPopular`. An empty input yields an empty
 * `byPlan` dictionary, `totalSites: 0`, and `mostPopular: ''`.
 *
 * @param metrics - Array of per-plan metric snapshots.
 * @returns Aggregated plan rollup.
 *
 * @example
 * const r = aggregatePlanMetrics([
 *   { plan: 'starter',    siteCount: 10, totalVisitors: 1000, totalConversions: 50,  avgScore: 72 },
 *   { plan: 'pro',        siteCount: 25, totalVisitors: 5000, totalConversions: 200, avgScore: 85 },
 *   { plan: 'enterprise', siteCount: 5,  totalVisitors: 500,  totalConversions: 30,  avgScore: 91 },
 * ]);
 * // { byPlan: { starter: { … }, pro: { … }, enterprise: { … } },
 * //   totalSites: 40, mostPopular: 'pro' }
 *
 * @example
 * aggregatePlanMetrics([]);
 * // { byPlan: {}, totalSites: 0, mostPopular: '' }
 */
export function aggregatePlanMetrics(metrics: readonly PlanMetric[]): AggregateResult {
  if (metrics.length === 0) {
    return { byPlan: {}, totalSites: 0, mostPopular: '' };
  }

  const byPlan: Record<string, PlanMetric> = {};
  let totalSites = 0;
  let maxSiteCount = -1;
  let mostPopular = '';

  for (const m of metrics) {
    totalSites += m.siteCount;

    const existing = byPlan[m.plan];
    if (existing) {
      // Accumulate: sum counters, re-average avgScore
      const newSiteCount = existing.siteCount + m.siteCount;
      const newVisitors = existing.totalVisitors + m.totalVisitors;
      const newConversions = existing.totalConversions + m.totalConversions;
      const weightedAvg = existing.siteCount * existing.avgScore + m.siteCount * m.avgScore;
      byPlan[m.plan] = {
        plan: m.plan,
        siteCount: newSiteCount,
        totalVisitors: newVisitors,
        totalConversions: newConversions,
        avgScore: newSiteCount > 0 ? weightedAvg / newSiteCount : 0,
      };
    } else {
      byPlan[m.plan] = { ...m };
    }

    // Track most popular
    if (byPlan[m.plan].siteCount > maxSiteCount) {
      maxSiteCount = byPlan[m.plan].siteCount;
      mostPopular = m.plan;
    }
  }

  return { byPlan, totalSites, mostPopular };
}

/**
 * Compute the percentage of total sites assigned to each plan.
 *
 * Returns an array sorted descending by percentage. Empty input yields an
 * empty array. Percentages are rounded to one decimal place and sum to
 * 100.0 (may reach 100.1 due to rounding — callers should format as
 * integer percentage or accept the tiny delta).
 *
 * @param metrics - Array of per-plan metric snapshots.
 * @returns Percentage breakdown sorted descending.
 *
 * @example
 * planDistribution([
 *   { plan: 'starter',    siteCount: 10, totalVisitors: 1000, totalConversions: 50,  avgScore: 72 },
 *   { plan: 'pro',        siteCount: 25, totalVisitors: 5000, totalConversions: 200, avgScore: 85 },
 * ]);
 * // [{ plan: 'pro', pct: 71.4 }, { plan: 'starter', pct: 28.6 }]
 *
 * @example
 * planDistribution([]);
 * // []
 */
export function planDistribution(metrics: readonly PlanMetric[]): { plan: string; pct: number }[] {
  const totalSites = metrics.reduce((sum, m) => sum + m.siteCount, 0);

  if (totalSites === 0) {
    return [];
  }

  return metrics
    .map((m) => ({
      plan: m.plan,
      pct: Math.round((m.siteCount / totalSites) * 1000) / 10,
    }))
    .sort((a, b) => b.pct - a.pct);
}
