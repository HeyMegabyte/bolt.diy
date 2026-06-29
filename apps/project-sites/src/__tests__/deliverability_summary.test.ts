import {
  aggregateDeliverability,
  dailyTrend,
  type SuppressionRow,
} from '../services/deliverability_summary.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function make(overrides: Partial<SuppressionRow> = {}): SuppressionRow {
  return { reason: 'bounce', subType: 'Permanent', createdAtMs: now - DAY, ...overrides };
}

describe('aggregateDeliverability (LM23)', () => {
  it('calculates bounce/complaint rates from suppression rows', () => {
    const rows = [
      make({ reason: 'bounce', subType: 'Permanent' }),
      make({ reason: 'bounce', subType: 'Permanent' }),
      make({ reason: 'bounce', subType: 'Transient' }),
      make({ reason: 'complaint' }),
    ];
    const c = aggregateDeliverability(rows, 100);
    expect(c.bounces).toBe(3);
    expect(c.complaints).toBe(1);
    expect(c.bounceRate).toBe(3); // 300/10000 * 100, one decimal = 3.0
    expect(c.complaintRate).toBe(1); // 1/100 * 100 = 1.0
    expect(c.bounceBreakdown.Permanent).toBe(2);
    expect(c.bounceBreakdown.Transient).toBe(1);
  });

  it('returns all-zero rates + empty breakdowns when no sends', () => {
    const c = aggregateDeliverability([make()], 0);
    expect(c.bounceRate).toBe(0);
    expect(c.complaintRate).toBe(0);
  });

  it('never throws on junk/empty input', () => {
    expect(aggregateDeliverability([], 1).bounces).toBe(0);
    expect(aggregateDeliverability(undefined as unknown as [], 1).sent).toBe(1);
  });
});

describe('dailyTrend (LM23)', () => {
  it('buckets suppressions by YYYY-MM-DD within the window', () => {
    const yesterday = now - DAY;
    const today = now;
    const rows = [
      make({ reason: 'bounce', createdAtMs: yesterday }),
      make({ reason: 'complaint', createdAtMs: today }),
    ];
    const trend = dailyTrend(rows, { [new Date(yesterday).toISOString().slice(0, 10)]: 500 }, 30);
    expect(trend.length).toBeGreaterThanOrEqual(1);
    const yd = trend.find((t) => t.bounces > 0);
    expect(yd).toBeDefined();
    expect(yd!.sent).toBe(500);
    const td = trend.find((t) => t.complaints > 0);
    expect(td).toBeDefined();
    expect(td!.sent).toBe(0);
  });

  it('returns empty array for empty/no-input', () => {
    expect(dailyTrend([], {})).toEqual([]);
    expect(dailyTrend(undefined as unknown as SuppressionRow[], {})).toEqual([]);
  });
});
