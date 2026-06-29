import {
  aggregatePlanMetrics,
  planDistribution,
  type PlanMetric,
} from '../plan_metrics';

const STUB_METRICS: readonly PlanMetric[] = [
  { plan: 'starter',    siteCount: 10, totalVisitors: 1_000, totalConversions: 50,  avgScore: 72 },
  { plan: 'pro',        siteCount: 25, totalVisitors: 5_000, totalConversions: 200, avgScore: 85 },
  { plan: 'enterprise', siteCount: 5,  totalVisitors: 500,   totalConversions: 30,  avgScore: 91 },
];

describe('aggregatePlanMetrics', () => {
  it('returns empty state for empty input', () => {
    const result = aggregatePlanMetrics([]);
    expect(result).toEqual({ byPlan: {}, totalSites: 0, mostPopular: '' });
  });

  it('returns per-plan aggregates with totalSites and mostPopular', () => {
    const result = aggregatePlanMetrics(STUB_METRICS);

    expect(result.totalSites).toBe(40);
    expect(result.mostPopular).toBe('pro');

    expect(result.byPlan.starter).toEqual({
      plan: 'starter',
      siteCount: 10,
      totalVisitors: 1_000,
      totalConversions: 50,
      avgScore: 72,
    });

    expect(result.byPlan.pro).toEqual({
      plan: 'pro',
      siteCount: 25,
      totalVisitors: 5_000,
      totalConversions: 200,
      avgScore: 85,
    });

    expect(result.byPlan.enterprise).toEqual({
      plan: 'enterprise',
      siteCount: 5,
      totalVisitors: 500,
      totalConversions: 30,
      avgScore: 91,
    });
  });

  it('aggregates duplicate plan keys by summing counters and re-averaging avgScore', () => {
    const result = aggregatePlanMetrics([
      { plan: 'pro', siteCount: 10, totalVisitors: 2_000, totalConversions: 100, avgScore: 80 },
      { plan: 'pro', siteCount: 5,  totalVisitors: 500,   totalConversions: 30,  avgScore: 90 },
    ]);

    expect(result.totalSites).toBe(15);
    expect(result.mostPopular).toBe('pro');

    // siteCount: 10+5=15, visitors: 2000+500=2500, conversions: 100+30=130
    // weighted avgScore: (10*80 + 5*90) / 15 = (800+450)/15 = 83.33...
    expect(result.byPlan.pro).toEqual({
      plan: 'pro',
      siteCount: 15,
      totalVisitors: 2_500,
      totalConversions: 130,
      avgScore: 1250 / 15, // ≈ 83.33
    });
  });

  it('handles a single metric entry', () => {
    const result = aggregatePlanMetrics([STUB_METRICS[0]]);

    expect(result.totalSites).toBe(10);
    expect(result.mostPopular).toBe('starter');
    expect(result.byPlan.starter).toEqual(STUB_METRICS[0]);
  });

  it('mostPopular is first plan when all have same siteCount', () => {
    const result = aggregatePlanMetrics([
      { plan: 'a', siteCount: 5, totalVisitors: 100, totalConversions: 10, avgScore: 80 },
      { plan: 'b', siteCount: 5, totalVisitors: 200, totalConversions: 20, avgScore: 85 },
    ]);

    expect(result.mostPopular).toBe('a');
    expect(result.totalSites).toBe(10);
  });

  it('preserves the input shape in output entries', () => {
    const result = aggregatePlanMetrics(STUB_METRICS);

    for (const plan of ['starter', 'pro', 'enterprise'] as const) {
      const entry = result.byPlan[plan];
      expect(entry).toBeDefined();
      expect(entry.plan).toBe(plan);
      expect(entry.siteCount).toEqual(expect.any(Number));
      expect(entry.totalVisitors).toEqual(expect.any(Number));
      expect(entry.totalConversions).toEqual(expect.any(Number));
      expect(entry.avgScore).toEqual(expect.any(Number));
    }
  });

  it('does not mutate the input array', () => {
    const copy = [...STUB_METRICS];
    aggregatePlanMetrics(STUB_METRICS);
    expect(STUB_METRICS).toEqual(copy);
  });
});

describe('planDistribution', () => {
  it('returns empty array for empty input', () => {
    expect(planDistribution([])).toEqual([]);
  });

  it('returns 100% for a single plan', () => {
    const result = planDistribution([STUB_METRICS[0]]);
    expect(result).toEqual([{ plan: 'starter', pct: 100.0 }]);
  });

  it('returns percentage breakdown sorted descending', () => {
    const result = planDistribution(STUB_METRICS);

    // starter: 10/40=25%, pro: 25/40=62.5%, enterprise: 5/40=12.5%
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ plan: 'pro', pct: 62.5 });
    expect(result[1]).toEqual({ plan: 'starter', pct: 25.0 });
    expect(result[2]).toEqual({ plan: 'enterprise', pct: 12.5 });
  });

  it('is descending order by pct', () => {
    const result = planDistribution(STUB_METRICS);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].pct).toBeLessThanOrEqual(result[i - 1].pct);
    }
  });

  it('returns empty array when all siteCounts are zero', () => {
    const result = planDistribution([
      { plan: 'free', siteCount: 0, totalVisitors: 0, totalConversions: 0, avgScore: 0 },
      { plan: 'pro',  siteCount: 0, totalVisitors: 0, totalConversions: 0, avgScore: 0 },
    ]);
    expect(result).toEqual([]);
  });

  it('returns one entry per plan even when siteCount is zero among non-zero entries', () => {
    const result = planDistribution([
      { plan: 'free', siteCount: 0, totalVisitors: 0, totalConversions: 0, avgScore: 0 },
      { plan: 'pro',  siteCount: 10, totalVisitors: 100, totalConversions: 5, avgScore: 80 },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ plan: 'pro', pct: 100.0 });
    expect(result[1]).toEqual({ plan: 'free', pct: 0.0 });
  });

  it('does not mutate the input array', () => {
    const copy = [...STUB_METRICS];
    planDistribution(STUB_METRICS);
    expect(STUB_METRICS).toEqual(copy);
  });
});

describe('TypeScript contract', () => {
  it('PlanMetric is a valid structural type', () => {
    const m: PlanMetric = {
      plan: 'test',
      siteCount: 1,
      totalVisitors: 100,
      totalConversions: 10,
      avgScore: 75,
    };
    expect(m.plan).toBe('test');
  });

  it('planDistribution returns items matching the expected shape', () => {
    const result = planDistribution(STUB_METRICS);
    expect(result[0]).toHaveProperty('plan');
    expect(result[0]).toHaveProperty('pct');
    expect(typeof result[0].pct).toBe('number');
  });
});
