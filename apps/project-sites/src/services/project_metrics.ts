/**
 * @module services/project_metrics
 * @description Pure cross-project metrics rollup for the admin dashboard.
 *
 * Takes an array of {@link ProjectMetric} records from individual sites and
 * produces dashboard-level aggregates: totals, averages, ranking, and top-performer
 * detection. Zero side-effects — safe to call from cron, API handlers, or tests
 * without mocking.
 *
 * ## Metric shape
 *
 * Every `ProjectMetric` is a scalar snapshot of one site's current state:
 *
 * | Field          | Description                          |
 * | -------------- | ------------------------------------ |
 * | `siteId`       | Site UUID                            |
 * | `slug`         | Site subdomain slug                  |
 * | `visitors`     | Total unique visitors (lifetime)     |
 * | `pageviews`    | Total pageviews (lifetime)           |
 * | `conversions`  | Total conversions (lifetime)         |
 * | `storageBytes` | Bytes of stored assets (R2 + DB)     |
 * | `buildCount`   | Number of builds triggered           |
 */

/** A single site's current metrics snapshot. */
export interface ProjectMetric {
  siteId: string;
  slug: string;
  visitors: number;
  pageviews: number;
  conversions: number;
  storageBytes: number;
  buildCount: number;
}

/** Aggregated rollup across a project collection. */
export interface RollupResult {
  /** Total number of sites in the collection. */
  totalSites: number;
  /** Sum of `visitors` across all sites. */
  totalVisitors: number;
  /** Sum of `conversions` across all sites. */
  totalConversions: number;
  /** Weighted average conversion rate (totalConversions / totalVisitors), or 0 when totalVisitors is 0. */
  avgConversionRate: number;
  /** The site with the highest visitor count, or `null` for an empty collection. */
  topSite: ProjectMetric | null;
}

/**
 * Roll up an array of per-site metrics into dashboard-level aggregates.
 *
 * Computes totals, the weighted average conversion rate (totalConversions /
 * totalVisitors), and the top-performing site by visitor count.  Returns a
 * zero-state (`totalSites: 0`, `topSite: null`) when the input is empty.
 *
 * @param metrics - Array of per-site metric snapshots.
 * @returns Aggregated dashboard rollup.
 *
 * @example
 * rollupMetrics([
 *   { siteId: 's1', slug: 'alpha',  visitors: 1000, pageviews: 5000, conversions: 50,  storageBytes: 2_000_000, buildCount: 12 },
 *   { siteId: 's2', slug: 'beta',   visitors: 2000, pageviews: 8000, conversions: 120, storageBytes: 4_000_000, buildCount: 8 },
 * ]);
 * // → { avgConversionRate: 0.0567, topSite: { …slug:'beta'… }, totalConversions: 170, totalSites: 2, totalVisitors: 3000 }
 *
 * @example
 * rollupMetrics([]);
 * // → { avgConversionRate: 0, topSite: null, totalConversions: 0, totalSites: 0, totalVisitors: 0 }
 */
export function rollupMetrics(metrics: readonly ProjectMetric[]): RollupResult {
  const totalSites = metrics.length;
  if (totalSites === 0) {
    return {
      avgConversionRate: 0,
      topSite: null,
      totalConversions: 0,
      totalSites: 0,
      totalVisitors: 0,
    };
  }

  let totalVisitors = 0;
  let totalConversions = 0;
  let topSite: ProjectMetric = metrics[0];

  for (const m of metrics) {
    totalVisitors += m.visitors;
    totalConversions += m.conversions;

    if (m.visitors > topSite.visitors) {
      topSite = m;
    }
  }

  const avgConversionRate = totalVisitors > 0 ? totalConversions / totalVisitors : 0;

  return {
    avgConversionRate,
    topSite,
    totalConversions,
    totalSites,
    totalVisitors,
  };
}

/**
 * Sort and slice an array of metrics by a numeric field.
 *
 * Returns the top-N performers (descending). When `topN` is omitted, all
 * metrics are returned in ranked order. When `topN` exceeds the array length,
 * the full sorted array is returned (no padding).
 *
 * @param metrics - Array of per-site metric snapshots.
 * @param field   - The numeric field to rank by.
 * @param topN    - Maximum number of results to return (optional).
 * @returns Metrics sorted descending by `field`, limited to `topN` entries.
 *
 * @example
 * rankBy(metrics, 'visitors', 3);
 * // → [top 3 sites by visitor count]
 *
 * @example
 * rankBy(metrics, 'conversions');
 * // → all sites sorted by conversions descending
 */
export function rankBy(
  metrics: readonly ProjectMetric[],
  field: 'visitors' | 'pageviews' | 'conversions',
  topN?: number,
): ProjectMetric[] {
  const sorted = [...metrics].sort((a, b) => b[field] - a[field]);

  if (topN !== undefined && topN < sorted.length) {
    return sorted.slice(0, topN);
  }

  return sorted;
}
