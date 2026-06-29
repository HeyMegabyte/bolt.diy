/**
 * rollupMetrics / rankBy — pure cross-project metrics rollup.
 * Zero side-effects, zero mocks needed.
 */
import { rollupMetrics, rankBy, type ProjectMetric } from '../services/project_metrics.js';

const SAMPLE_METRICS: readonly ProjectMetric[] = [
  {
    siteId: 's1',
    slug: 'alpha',
    visitors: 1000,
    pageviews: 5000,
    conversions: 50,
    storageBytes: 2_000_000,
    buildCount: 12,
  },
  {
    siteId: 's2',
    slug: 'beta',
    visitors: 2000,
    pageviews: 8000,
    conversions: 120,
    storageBytes: 4_000_000,
    buildCount: 8,
  },
  {
    siteId: 's3',
    slug: 'gamma',
    visitors: 500,
    pageviews: 2000,
    conversions: 30,
    storageBytes: 1_000_000,
    buildCount: 5,
  },
  {
    siteId: 's4',
    slug: 'delta',
    visitors: 0,
    pageviews: 0,
    conversions: 0,
    storageBytes: 500_000,
    buildCount: 1,
  },
  {
    siteId: 's5',
    slug: 'epsilon',
    visitors: 3000,
    pageviews: 0,
    conversions: 0,
    storageBytes: 0,
    buildCount: 3,
  },
];

// ---------------------------------------------------------------------------
// rollupMetrics
// ---------------------------------------------------------------------------

describe('rollupMetrics', () => {
  it('aggregates totalSites, totalVisitors, totalConversions from all metrics', () => {
    const r = rollupMetrics(SAMPLE_METRICS);
    expect(r.totalSites).toBe(5);
    // 1000 + 2000 + 500 + 0 + 3000
    expect(r.totalVisitors).toBe(6500);
    // 50 + 120 + 30 + 0 + 0
    expect(r.totalConversions).toBe(200);
  });

  it('computes a weighted avgConversionRate', () => {
    const r = rollupMetrics(SAMPLE_METRICS);
    // 200 / 6500 ≈ 0.030769
    expect(r.avgConversionRate).toBeCloseTo(0.030769, 4);
  });

  it('returns avgConversionRate of 0 when totalVisitors is 0', () => {
    const r = rollupMetrics([
      {
        siteId: 'x',
        slug: 'zero',
        visitors: 0,
        pageviews: 0,
        conversions: 5,
        storageBytes: 0,
        buildCount: 0,
      },
    ]);
    expect(r.avgConversionRate).toBe(0);
    expect(r.totalVisitors).toBe(0);
    expect(r.totalConversions).toBe(5);
  });

  it('identifies the topSite as the one with the most visitors', () => {
    const r = rollupMetrics(SAMPLE_METRICS);
    expect(r.topSite).not.toBeNull();
    expect(r.topSite!.slug).toBe('epsilon');
    expect(r.topSite!.visitors).toBe(3000);
  });

  it('returns topSite as the only site when given a single metric', () => {
    const metrics: readonly ProjectMetric[] = [
      {
        siteId: 'solo',
        slug: 'solo-site',
        visitors: 42,
        pageviews: 100,
        conversions: 3,
        storageBytes: 1_000,
        buildCount: 2,
      },
    ];
    const r = rollupMetrics(metrics);
    expect(r.totalSites).toBe(1);
    expect(r.topSite!.siteId).toBe('solo');
    expect(r.avgConversionRate).toBeCloseTo(3 / 42, 5);
  });

  it('returns zero-state for an empty array', () => {
    const r = rollupMetrics([]);
    expect(r).toEqual({
      avgConversionRate: 0,
      topSite: null,
      totalConversions: 0,
      totalSites: 0,
      totalVisitors: 0,
    });
  });

  it('ties go to the first metric with the same visitor count (stable)', () => {
    const metrics: readonly ProjectMetric[] = [
      {
        siteId: 'a',
        slug: 'first',
        visitors: 100,
        pageviews: 0,
        conversions: 0,
        storageBytes: 0,
        buildCount: 0,
      },
      {
        siteId: 'b',
        slug: 'second',
        visitors: 100,
        pageviews: 0,
        conversions: 0,
        storageBytes: 0,
        buildCount: 0,
      },
      {
        siteId: 'c',
        slug: 'third',
        visitors: 50,
        pageviews: 0,
        conversions: 0,
        storageBytes: 0,
        buildCount: 0,
      },
    ];
    const r = rollupMetrics(metrics);
    expect(r.topSite!.siteId).toBe('a');
  });

  it('does not mutate the input array', () => {
    const copy = [...SAMPLE_METRICS];
    rollupMetrics(SAMPLE_METRICS);
    expect(SAMPLE_METRICS).toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// rankBy
// ---------------------------------------------------------------------------

describe('rankBy', () => {
  it('sorts descending by the given field', () => {
    const r = rankBy(SAMPLE_METRICS, 'visitors');
    expect(r.map((m) => m.slug)).toEqual(['epsilon', 'beta', 'alpha', 'gamma', 'delta']);
  });

  it('limits to topN entries when topN is provided', () => {
    const r = rankBy(SAMPLE_METRICS, 'visitors', 3);
    expect(r).toHaveLength(3);
    expect(r[0].slug).toBe('epsilon');
    expect(r[1].slug).toBe('beta');
    expect(r[2].slug).toBe('alpha');
  });

  it('returns all metrics when topN exceeds array length', () => {
    const r = rankBy(SAMPLE_METRICS, 'visitors', 999);
    expect(r).toHaveLength(SAMPLE_METRICS.length);
  });

  it('returns all metrics when topN is undefined', () => {
    const r = rankBy(SAMPLE_METRICS, 'pageviews');
    expect(r).toHaveLength(SAMPLE_METRICS.length);
    // beta(8000) > alpha(5000) > gamma(2000) > epsilon(0) > delta(0)
    // epsilon has 0 pageviews like delta, stable sort keeps epsilon before delta
    expect(r[0].slug).toBe('beta');
  });

  it('sorts by conversions correctly', () => {
    const r = rankBy(SAMPLE_METRICS, 'conversions');
    expect(r[0].slug).toBe('beta'); // 120
    expect(r[1].slug).toBe('alpha'); // 50
    expect(r[2].slug).toBe('gamma'); // 30
  });

  it('handles empty array', () => {
    expect(rankBy([], 'visitors')).toEqual([]);
    expect(rankBy([], 'visitors', 3)).toEqual([]);
  });

  it('handles single-element array', () => {
    const single: readonly ProjectMetric[] = [
      {
        siteId: 'x',
        slug: 'lonely',
        visitors: 1,
        pageviews: 2,
        conversions: 3,
        storageBytes: 0,
        buildCount: 0,
      },
    ];
    expect(rankBy(single, 'visitors')).toHaveLength(1);
    expect(rankBy(single, 'visitors', 1)).toHaveLength(1);
    expect(rankBy(single, 'visitors', 0)).toHaveLength(0);
  });

  it('does not mutate the input array', () => {
    const copy = [...SAMPLE_METRICS];
    rankBy(SAMPLE_METRICS, 'visitors', 2);
    expect(SAMPLE_METRICS).toEqual(copy);
  });
});
