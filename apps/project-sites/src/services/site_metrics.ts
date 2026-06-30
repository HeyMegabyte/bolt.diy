/**
 * @module services/site_metrics
 * @description Pure aggregation of per-site metrics into dashboard rollups,
 * health scores, and trend calculations. Zero side-effects — safe to call from
 * cron, API handlers, or tests without mocking.
 *
 * ## Function overview
 *
 * | Function | Purpose |
 * | -------- | ------- |
 * | `aggregateSiteMetrics` | Sum counters, average scores, rank by traffic |
 * | `siteHealthScore` | Weighted 0-100 score from one site's metrics |
 * | `metricTrend` | Percentage change + direction between two periods |
 */

/** A single site's metric snapshot. */
export interface SiteMetric {
  /** Site UUID. */
  readonly siteId: string;
  /** Site subdomain slug. */
  readonly slug: string;
  /** Total unique visitors (lifetime). */
  readonly visitors: number;
  /** Total pageviews (lifetime). */
  readonly pageviews: number;
  /** Total conversions (lifetime). */
  readonly conversions: number;
  /** Average quality/health score for this site (0-100 scale). */
  readonly avgScore: number;
  /** Total number of builds triggered. */
  readonly buildCount: number;
}

/** Aggregated rollup across a collection of sites. */
export interface AggregatedSiteMetrics {
  /** Total sites in the collection. */
  readonly averageScore: number;
  /** The site with the highest visitor count, or `null` when empty. */
  readonly topSite: SiteMetric | null;
  /** Total builds across all sites. */
  readonly totalBuilds: number;
  /** Sum of `conversions` across all sites. */
  readonly totalConversions: number;
  /** Sum of `pageviews` across all sites. */
  readonly totalPageviews: number;
  /** Total sites in the collection. */
  readonly totalSites: number;
  /** Sum of `visitors` across all sites. */
  readonly totalVisitors: number;
}

/** Trend direction between two measurement periods. */
export type TrendDirection = 'up' | 'down' | 'flat';

/** Result of comparing a metric across two time periods. */
export interface MetricTrend {
  /** Absolute difference (current - previous). */
  readonly absoluteChange: number;
  /** Direction of change. */
  readonly direction: TrendDirection;
  /** Percentage change rounded to one decimal. 0 when previous is 0. */
  readonly percentChange: number;
}

/**
 * Aggregate an array of per-site metric snapshots into dashboard-level rollups.
 *
 * Sums visitors, pageviews, conversions, and build counts; computes a
 * siteCount-weighted average score; identifies the top site by visitor count.
 * Empty input yields a zero-value result with `topSite: null`.
 *
 * @param sites - Array of per-site metric snapshots.
 * @returns Aggregated dashboard rollup.
 *
 * @example
 * aggregateSiteMetrics([
 *   { siteId: 's1', slug: 'alpha',  visitors: 1000, pageviews: 5000, conversions: 50,  avgScore: 78, buildCount: 12 },
 *   { siteId: 's2', slug: 'beta',   visitors: 2000, pageviews: 8000, conversions: 120, avgScore: 85, buildCount: 8 },
 * ]);
 * // → { totalSites: 2, totalVisitors: 3000, totalPageviews: 13000, totalConversions: 170,
 * //      averageScore: 82.7, topSite: { …slug:'beta'… }, totalBuilds: 20 }
 *
 * @example
 * aggregateSiteMetrics([]);
 * // → { totalSites: 0, totalVisitors: 0, totalPageviews: 0, totalConversions: 0,
 * //      averageScore: 0, topSite: null, totalBuilds: 0 }
 */
export function aggregateSiteMetrics(sites: readonly SiteMetric[]): AggregatedSiteMetrics {
  const totalSites = sites.length;
  if (totalSites === 0) {
    return {
      averageScore: 0,
      topSite: null,
      totalBuilds: 0,
      totalConversions: 0,
      totalPageviews: 0,
      totalSites: 0,
      totalVisitors: 0,
    };
  }

  let totalVisitors = 0;
  let totalPageviews = 0;
  let totalConversions = 0;
  let totalBuilds = 0;
  let weightedScoreSum = 0;
  let topSite: SiteMetric = sites[0];

  for (const s of sites) {
    totalVisitors += s.visitors;
    totalPageviews += s.pageviews;
    totalConversions += s.conversions;
    totalBuilds += s.buildCount;
    weightedScoreSum += s.avgScore;

    if (s.visitors > topSite.visitors) {
      topSite = s;
    }
  }

  const averageScore = totalSites > 0 ? Math.round((weightedScoreSum / totalSites) * 10) / 10 : 0;

  return {
    averageScore,
    topSite,
    totalBuilds,
    totalConversions,
    totalPageviews,
    totalSites,
    totalVisitors,
  };
}

/**
 * Compute a composite health score (0-100) for a single site based on its
 * current metrics.
 *
 * The formula weights four dimensions:
 * - **Engagement** (35%): conversions ÷ visitors (conversion rate), capped at 20%
 * - **Build velocity** (25%): builds per-site, scaled non-linearly
 *   (log2(buildCount + 1) × ~6.25)
 * - **Quality** (30%): the site's own avgScore directly
 * - **Page depth** (10%): pages per visitor (pageviews ÷ visitors), capped at 10
 *
 * Returns 0 when visitors is 0 (no data yet).
 *
 * @param metric - Single site's metric snapshot.
 * @returns Health score 0-100, rounded to one decimal.
 *
 * @example
 * siteHealthScore({ siteId: 's1', slug: 'alpha', visitors: 1000, pageviews: 5000,
 *                   conversions: 50, avgScore: 78, buildCount: 12 });
 * // → ~68.0
 *
 * @example
 * siteHealthScore({ siteId: 's1', slug: 'empty', visitors: 0, pageviews: 0,
 *                   conversions: 0, avgScore: 0, buildCount: 0 });
 * // → 0
 */
export function siteHealthScore(metric: SiteMetric): number {
  if (metric.visitors <= 0) {
    return 0;
  }

  // Engagement: conversion rate capped at 20%, scaled to 35% of score
  const conversionRate = Math.min(metric.conversions / metric.visitors, 0.2);
  const engagementScore = (conversionRate / 0.2) * 35;

  // Build velocity: log2(buildCount + 1) × 6.25, scaled to 25% of score
  const buildFactor = Math.log2(metric.buildCount + 1) * 6.25;
  const buildScore = Math.min(buildFactor, 25);

  // Quality: avgScore directly, scaled to 30% of score
  const qualityScore = (metric.avgScore / 100) * 30;

  // Page depth: pages per visitor, capped at 10, scaled to 10% of score
  const pagesPerVisitor = metric.visitors > 0 ? metric.pageviews / metric.visitors : 0;
  const depthScore = (Math.min(pagesPerVisitor, 10) / 10) * 10;

  const raw = engagementScore + buildScore + qualityScore + depthScore;

  return Math.round(raw * 10) / 10;
}

/**
 * Compare a metric value across two time periods.
 *
 * Computes absolute and percentage change, and classifies the direction.
 * Direction is `'flat'` when the absolute percentage change is <1%.
 * When `previous` is 0, `percentChange` is 0 (division by zero guard) and
 * direction falls through the absolute comparison.
 *
 * @param current - Current period value.
 * @param previous - Previous period value.
 * @returns Trend result with direction, absolute change, and percent change.
 *
 * @example
 * metricTrend(120, 100);
 * // → { direction: 'up', absoluteChange: 20, percentChange: 20 }
 *
 * @example
 * metricTrend(80, 100);
 * // → { direction: 'down', absoluteChange: -20, percentChange: -20 }
 *
 * @example
 * metricTrend(100.4, 100);
 * // → { direction: 'flat', absoluteChange: 0.4, percentChange: 0.4 }
 */
export function metricTrend(current: number, previous: number): MetricTrend {
  const absoluteChange = current - previous;
  const percentChange =
    previous !== 0 ? Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10 : 0;

  const direction: TrendDirection =
    previous === 0
      ? current > 0
        ? 'up'
        : 'flat'
      : current === previous
        ? 'flat'
        : Math.abs(percentChange) < 1
          ? 'flat'
          : current > previous
            ? 'up'
            : 'down';

  return { absoluteChange, direction, percentChange };
}
