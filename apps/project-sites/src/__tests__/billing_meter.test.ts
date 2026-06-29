import { aggregateMeter, billableOnly } from '../services/billing_meter.js';
import type { UsageCounter } from '../services/billing_meter.js';

/**
 * Unit tests for the billing meter module.
 *
 * Covers aggregateMeter and billableOnly with edge cases.
 */

// ─── Helpers ───────────────────────────────────────────────────

function makeCounter(overrides: Partial<UsageCounter> = {}): UsageCounter {
  return {
    app: 'projectsites',
    metric: 'builds',
    count: 10,
    periodStartMs: 1000000,
    periodEndMs: 2000000,
    ...overrides,
  };
}

// ─── aggregateMeter ────────────────────────────────────────────

describe('aggregateMeter', () => {
  it('aggregates matching app+metric by summing counts', () => {
    const counters = [makeCounter({ count: 5 }), makeCounter({ count: 3 })];

    const result = aggregateMeter(counters);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].count).toBe(8);
    expect(result.lines[0].app).toBe('projectsites');
    expect(result.lines[0].metric).toBe('builds');
  });

  it('computes estimated cost from METRIC_PRICING correctly', () => {
    const counters = [
      makeCounter({ metric: 'builds', count: 2 }), // 2 * 5c = 10c
      makeCounter({ metric: 'ai_calls', count: 100 }), // 100 * 1c = 100c
      makeCounter({ metric: 'emails', count: 10 }), // 10 * 0.05c = 0.5c
    ];

    const result = aggregateMeter(counters);

    expect(result.lines).toHaveLength(3);

    const builds = result.lines.find((l) => l.metric === 'builds');
    expect(builds!.estimatedCents).toBe(10);

    const aiCalls = result.lines.find((l) => l.metric === 'ai_calls');
    expect(aiCalls!.estimatedCents).toBe(100);

    const emails = result.lines.find((l) => l.metric === 'emails');
    expect(emails!.estimatedCents).toBe(0.5);
  });

  it('computes totalCents as sum of all estimatedCents', () => {
    const counters = [
      makeCounter({ metric: 'builds', count: 3 }), // 15c
      makeCounter({ metric: 'ai_calls', count: 5 }), // 5c
    ];

    const result = aggregateMeter(counters);

    expect(result.totalCents).toBe(20);
  });

  it('returns an empty BillingMeter for empty input', () => {
    const result = aggregateMeter([]);

    expect(result.lines).toEqual([]);
    expect(result.totalCents).toBe(0);
    expect(result.periodStartMs).toBe(0);
    expect(result.periodEndMs).toBe(0);
  });

  it('clamps negative counts to 0', () => {
    const counters = [makeCounter({ count: -5 }), makeCounter({ count: -3 })];

    const result = aggregateMeter(counters);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].count).toBe(0);
  });

  it('clamps negative count and positive count to positive sum', () => {
    const counters = [makeCounter({ count: -10 }), makeCounter({ count: 4 })];

    const result = aggregateMeter(counters);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].count).toBe(4);
  });

  it('returns estimatedCents = 0 for unknown metrics', () => {
    const counters = [makeCounter({ metric: 'unknown_metric', count: 100 })];

    const result = aggregateMeter(counters);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].estimatedCents).toBe(0);
  });

  it('produces separate lines for different apps with the same metric', () => {
    const counters = [
      makeCounter({ app: 'projectsites', metric: 'builds', count: 5 }),
      makeCounter({ app: 'plane', metric: 'builds', count: 3 }),
    ];

    const result = aggregateMeter(counters);

    expect(result.lines).toHaveLength(2);

    const psBuilds = result.lines.find((l) => l.app === 'projectsites');
    const planeBuilds = result.lines.find((l) => l.app === 'plane');
    expect(psBuilds!.count).toBe(5);
    expect(planeBuilds!.count).toBe(3);
  });

  it('produces separate lines for different metrics in the same app', () => {
    const counters = [
      makeCounter({ metric: 'sites', count: 2 }),
      makeCounter({ metric: 'builds', count: 7 }),
    ];

    const result = aggregateMeter(counters);

    expect(result.lines).toHaveLength(2);
    const total = result.lines.reduce((s, l) => s + l.count, 0);
    expect(total).toBe(9);
  });

  it('sets periodStartMs and periodEndMs from the first counter', () => {
    const counters = [makeCounter({ periodStartMs: 111, periodEndMs: 222 })];

    const result = aggregateMeter(counters);

    expect(result.periodStartMs).toBe(111);
    expect(result.periodEndMs).toBe(222);
  });

  it('has correct stripePayload structure', () => {
    const counters = [
      makeCounter({ app: 'twenty', metric: 'ai_calls', count: 42, periodEndMs: 2000000 }),
    ];

    const result = aggregateMeter(counters);

    expect(result.lines[0].stripePayload).toEqual({
      app: 'twenty',
      metric: 'ai_calls',
      count: 42,
      timestamp_ms: 2000000,
    });
  });

  it('has correct meterEventName format', () => {
    const counters = [makeCounter({ app: 'listmonk', metric: 'emails' })];

    const result = aggregateMeter(counters);

    expect(result.lines[0].meterEventName).toBe('listmonk_emails');
  });
});

// ─── billableOnly ──────────────────────────────────────────────

describe('billableOnly', () => {
  it('filters lines with count === 0', () => {
    const lines = [
      {
        app: 'a',
        metric: 'x',
        count: 0,
        estimatedCents: 0,
        meterEventName: 'a_x',
        stripePayload: {},
      },
      {
        app: 'a',
        metric: 'y',
        count: 5,
        estimatedCents: 25,
        meterEventName: 'a_y',
        stripePayload: {},
      },
      {
        app: 'b',
        metric: 'x',
        count: 0,
        estimatedCents: 0,
        meterEventName: 'b_x',
        stripePayload: {},
      },
    ];

    const result = billableOnly(lines);

    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(5);
  });

  it('returns empty array when all lines are zero', () => {
    const lines = [
      {
        app: 'a',
        metric: 'x',
        count: 0,
        estimatedCents: 0,
        meterEventName: 'a_x',
        stripePayload: {},
      },
      {
        app: 'b',
        metric: 'y',
        count: 0,
        estimatedCents: 0,
        meterEventName: 'b_y',
        stripePayload: {},
      },
    ];

    const result = billableOnly(lines);

    expect(result).toEqual([]);
  });

  it('returns the same array when all lines have count > 0', () => {
    const lines = [
      {
        app: 'a',
        metric: 'x',
        count: 1,
        estimatedCents: 0,
        meterEventName: 'a_x',
        stripePayload: {},
      },
      {
        app: 'b',
        metric: 'y',
        count: 2,
        estimatedCents: 0,
        meterEventName: 'b_y',
        stripePayload: {},
      },
    ];

    const result = billableOnly(lines);

    expect(result).toHaveLength(2);
    expect(result).toEqual(lines);
  });

  it('handles empty input gracefully', () => {
    const result = billableOnly([]);

    expect(result).toEqual([]);
  });
});
