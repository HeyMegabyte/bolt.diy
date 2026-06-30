import {
  aggregateSiteMetrics,
  siteHealthScore,
  metricTrend,
  type SiteMetric,
} from '../site_metrics';

const STUB_SITES: readonly SiteMetric[] = [
  {
    siteId: 's1',
    slug: 'alpha',
    visitors: 1000,
    pageviews: 5000,
    conversions: 50,
    avgScore: 78,
    buildCount: 12,
  },
  {
    siteId: 's2',
    slug: 'beta',
    visitors: 2000,
    pageviews: 8000,
    conversions: 120,
    avgScore: 85,
    buildCount: 8,
  },
  {
    siteId: 's3',
    slug: 'gamma',
    visitors: 500,
    pageviews: 2000,
    conversions: 30,
    avgScore: 72,
    buildCount: 20,
  },
];

describe('aggregateSiteMetrics', () => {
  it('returns zero state for empty input', () => {
    const result = aggregateSiteMetrics([]);

    expect(result).toEqual({
      averageScore: 0,
      topSite: null,
      totalBuilds: 0,
      totalConversions: 0,
      totalPageviews: 0,
      totalSites: 0,
      totalVisitors: 0,
    });
  });

  it('sums visitors, pageviews, conversions, and builds', () => {
    const result = aggregateSiteMetrics(STUB_SITES);

    expect(result.totalSites).toBe(3);
    expect(result.totalVisitors).toBe(3500);
    expect(result.totalPageviews).toBe(15000);
    expect(result.totalConversions).toBe(200);
    expect(result.totalBuilds).toBe(40);
  });

  it('computes average score across all sites', () => {
    const result = aggregateSiteMetrics(STUB_SITES);

    // (78 + 85 + 72) / 3 = 78.33... → 78.3
    expect(result.averageScore).toBe(78.3);
  });

  it('picks topSite by visitor count', () => {
    const result = aggregateSiteMetrics(STUB_SITES);

    expect(result.topSite).not.toBeNull();
    expect(result.topSite!.slug).toBe('beta');
    expect(result.topSite!.visitors).toBe(2000);
  });

  it('handles a single site', () => {
    const result = aggregateSiteMetrics([STUB_SITES[0]]);

    expect(result.totalSites).toBe(1);
    expect(result.totalVisitors).toBe(1000);
    expect(result.totalPageviews).toBe(5000);
    expect(result.totalConversions).toBe(50);
    expect(result.totalBuilds).toBe(12);
    expect(result.averageScore).toBe(78);
    expect(result.topSite!.slug).toBe('alpha');
  });

  it('does not mutate the input array', () => {
    const copy = [...STUB_SITES];
    aggregateSiteMetrics(STUB_SITES);
    expect(STUB_SITES).toEqual(copy);
  });
});

describe('siteHealthScore', () => {
  it('returns 0 when visitors is 0', () => {
    const m: SiteMetric = {
      siteId: 's0',
      slug: 'empty',
      visitors: 0,
      pageviews: 0,
      conversions: 0,
      avgScore: 0,
      buildCount: 0,
    };
    expect(siteHealthScore(m)).toBe(0);
  });

  it('returns 0 when visitors is negative (defensive)', () => {
    const m: SiteMetric = {
      siteId: 's0',
      slug: 'bad',
      visitors: -1,
      pageviews: 0,
      conversions: 0,
      avgScore: 0,
      buildCount: 0,
    };
    expect(siteHealthScore(m)).toBe(0);
  });

  it('computes a score within 0-100 range', () => {
    const score = siteHealthScore(STUB_SITES[0]);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scores higher for better engagement + quality + builds', () => {
    const good: SiteMetric = {
      siteId: 'g',
      slug: 'good',
      visitors: 1000,
      pageviews: 8000,
      conversions: 150,
      avgScore: 95,
      buildCount: 50,
    };
    const poor: SiteMetric = {
      siteId: 'p',
      slug: 'poor',
      visitors: 1000,
      pageviews: 1000,
      conversions: 5,
      avgScore: 40,
      buildCount: 1,
    };

    expect(siteHealthScore(good)).toBeGreaterThan(siteHealthScore(poor));
  });

  it('increases roughly with buildCount', () => {
    const base: SiteMetric = {
      siteId: 'b',
      slug: 'base',
      visitors: 1000,
      pageviews: 3000,
      conversions: 50,
      avgScore: 70,
      buildCount: 1,
    };
    const midBuilds: SiteMetric = { ...base, buildCount: 4 };
    const moreBuilds: SiteMetric = { ...base, buildCount: 10 };

    const baseScore = siteHealthScore(base);
    const midScore = siteHealthScore(midBuilds);
    const moreScore = siteHealthScore(moreBuilds);

    expect(midScore).toBeGreaterThan(baseScore);
    expect(moreScore).toBeGreaterThan(midScore);
  });

  it('returns consistent score for the same input', () => {
    const a = siteHealthScore(STUB_SITES[1]);
    const b = siteHealthScore(STUB_SITES[1]);

    expect(a).toBe(b);
  });
});

describe('metricTrend', () => {
  it('classifies an increase as up', () => {
    const result = metricTrend(120, 100);

    expect(result.direction).toBe('up');
    expect(result.absoluteChange).toBe(20);
    expect(result.percentChange).toBe(20);
  });

  it('classifies a decrease as down', () => {
    const result = metricTrend(80, 100);

    expect(result.direction).toBe('down');
    expect(result.absoluteChange).toBe(-20);
    expect(result.percentChange).toBe(-20);
  });

  it('classifies <1% change as flat', () => {
    const result = metricTrend(100.4, 100);

    expect(result.direction).toBe('flat');
    expect(result.absoluteChange).toBeCloseTo(0.4);
    expect(result.percentChange).toBe(0.4);
  });

  it('classifies equal values as flat', () => {
    const result = metricTrend(100, 100);

    expect(result.direction).toBe('flat');
    expect(result.absoluteChange).toBe(0);
    expect(result.percentChange).toBe(0);
  });

  it('returns 0 percent change when previous is 0', () => {
    const result = metricTrend(50, 0);

    expect(result.direction).toBe('up');
    expect(result.absoluteChange).toBe(50);
    expect(result.percentChange).toBe(0);
  });

  it('rounds percentChange to one decimal', () => {
    const result = metricTrend(100, 3);

    // (100 - 3) / 3 = 32.33... → 3233.3 → 3233.3
    expect(result.percentChange).toBe(3233.3);
  });

  it('handles negative values (defensive)', () => {
    const result = metricTrend(-10, -20);

    expect(result.absoluteChange).toBe(10);
    expect(result.direction).toBe('up');
  });
});
