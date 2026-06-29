import {
  buildUsageReport,
  stripeMeterEvent,
  METRIC_PRICING,
  type UsageMetric,
  type UsageReport,
} from '../services/usage_reporter.js';

describe('METRIC_PRICING (usage_reporter)', () => {
  it('has all five metrics with positive pricing', () => {
    const keys: UsageMetric[] = ['sites', 'builds', 'ai_calls', 'emails', 'storage_gb'];
    for (const k of keys) {
      expect(METRIC_PRICING[k]).toBeGreaterThan(0);
    }
  });

  it('is a frozen constant', () => {
    expect(Object.isFrozen(METRIC_PRICING)).toBe(true);
  });
});

describe('buildUsageReport (usage_reporter)', () => {
  const period = { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' };

  it('computes totalCostCents from METRIC_PRICING', () => {
    const r = buildUsageReport('org_abc', period, { sites: 3, ai_calls: 1500, emails: 200 });
    // 3*50 + 0*10 + 1500*0.5 + 200*0.1 + 0*20 = 150 + 750 + 20 = 920
    expect(r.totalCostCents).toBe(920);
    expect(r.tenantId).toBe('org_abc');
    expect(r.metrics.sites).toBe(3);
    expect(r.metrics.builds).toBe(0);
    expect(r.metrics.ai_calls).toBe(1500);
    expect(r.metrics.emails).toBe(200);
    expect(r.metrics.storage_gb).toBe(0);
  });

  it('returns 0 total for empty metrics', () => {
    const r = buildUsageReport('org_empty', period, {});
    expect(r.totalCostCents).toBe(0);
    expect(r.metrics).toEqual({ sites: 0, builds: 0, ai_calls: 0, emails: 0, storage_gb: 0 });
  });

  it('clamps negative metric values to 0', () => {
    const r = buildUsageReport('org_neg', period, { sites: -5, ai_calls: -1 });
    expect(r.metrics.sites).toBe(0);
    expect(r.metrics.ai_calls).toBe(0);
    expect(r.totalCostCents).toBe(0);
  });

  it('clamps NaN / Infinity / null / undefined / string to 0', () => {
    const r = buildUsageReport('org_garbage', period, {
      sites: NaN,
      builds: Infinity,
      ai_calls: null as unknown as number,
      emails: undefined as unknown as number,
      storage_gb: 'abc' as unknown as number,
    });
    expect(r.totalCostCents).toBe(0);
  });

  it('floors fractional metrics', () => {
    const r = buildUsageReport('org_floor', period, { storage_gb: 3.7, ai_calls: 100.9 });
    expect(r.metrics.storage_gb).toBe(3);
    expect(r.metrics.ai_calls).toBe(100);
  });

  it('passes period through unchanged', () => {
    const r = buildUsageReport('org_p', period, {});
    expect(r.period).toEqual(period);
    expect(r.period.start).toBe(period.start);
    expect(r.period.end).toBe(period.end);
  });

  it('returns a plain object (not frozen, consumer may mutate)', () => {
    const r = buildUsageReport('org_unfrozen', period, { sites: 1 });
    expect(Object.isFrozen(r)).toBe(false);
  });
});

describe('stripeMeterEvent (usage_reporter)', () => {
  const period = { start: '2026-06-01T00:00:00Z', end: '2026-07-01T00:00:00Z' };

  it('emits one event per non-zero metric', () => {
    const r = buildUsageReport('org_multi', period, { sites: 2, ai_calls: 500, emails: 50 });
    const events = stripeMeterEvent(r);

    expect(events).toHaveLength(3);

    const names = events.map((e) => e.name);
    expect(names).toContain('usage.sites');
    expect(names).toContain('usage.ai_calls');
    expect(names).toContain('usage.emails');

    const sitesEvent = events.find((e) => e.name === 'usage.sites')!;
    expect(sitesEvent.payload).toMatchObject({
      tenant_id: 'org_multi',
      metric: 'sites',
      quantity: 2,
      cost_cents: 100, // 2 × 50
    });
  });

  it('returns empty array when every metric is zero', () => {
    const r = buildUsageReport('org_zero', period, {});
    expect(stripeMeterEvent(r)).toHaveLength(0);
  });

  it('includes builds and storage_gb when present', () => {
    const r = buildUsageReport('org_all', period, {
      sites: 1,
      builds: 10,
      ai_calls: 100,
      emails: 500,
      storage_gb: 5,
    });
    const events = stripeMeterEvent(r);
    expect(events).toHaveLength(5);
    expect(events.map((e) => e.name)).toEqual([
      'usage.sites',
      'usage.builds',
      'usage.ai_calls',
      'usage.emails',
      'usage.storage_gb',
    ]);
  });

  it('matches the UsageReport type contract', () => {
    const r: UsageReport = buildUsageReport('org_typed', period, { ai_calls: 100 });
    expect(r.tenantId).toBe('org_typed');
    expect(typeof r.totalCostCents).toBe('number');
    expect(typeof r.period.start).toBe('string');
  });
});
