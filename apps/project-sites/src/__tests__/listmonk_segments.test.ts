import {
  classifyCohort,
  bucketByCohort,
  LIFECYCLE_COHORTS,
  type SubscriberSignals,
} from '../services/listmonk_segments.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const daysAgo = (n: number): number => NOW - n * DAY;

describe('classifyCohort (LM10 listmonk_segments)', () => {
  it('explicit churn status wins over everything', () => {
    expect(
      classifyCohort({ id: 'u', createdAtMs: daysAgo(1), subscriptionStatus: 'canceled' }, NOW),
    ).toBe('churned');
    expect(
      classifyCohort({ id: 'u', createdAtMs: daysAgo(1), subscriptionStatus: 'past_due' }, NOW),
    ).toBe('churned');
  });

  it('classifies a recent signup as new (≤7d)', () => {
    expect(classifyCohort({ id: 'u', createdAtMs: daysAgo(3) }, NOW)).toBe('new');
  });

  it('classifies a trialing subscriber as trial (after the new window)', () => {
    expect(
      classifyCohort({ id: 'u', createdAtMs: daysAgo(20), subscriptionStatus: 'trialing' }, NOW),
    ).toBe('trial');
    expect(classifyCohort({ id: 'u', createdAtMs: daysAgo(20), plan: 'trial' }, NOW)).toBe('trial');
  });

  it('classifies a recently-active paid subscriber as active', () => {
    expect(
      classifyCohort(
        { id: 'u', createdAtMs: daysAgo(200), lastActiveAtMs: daysAgo(10), plan: 'pro' },
        NOW,
      ),
    ).toBe('active');
  });

  it('classifies 30–90d idle as dormant, >90d as churned', () => {
    expect(
      classifyCohort({ id: 'u', createdAtMs: daysAgo(200), lastActiveAtMs: daysAgo(45) }, NOW),
    ).toBe('dormant');
    expect(
      classifyCohort({ id: 'u', createdAtMs: daysAgo(200), lastActiveAtMs: daysAgo(120) }, NOW),
    ).toBe('churned');
  });

  it('falls back to createdAt when lastActive is absent', () => {
    expect(classifyCohort({ id: 'u', createdAtMs: daysAgo(200) }, NOW)).toBe('churned');
  });

  it('accepts ISO-string timestamps', () => {
    expect(
      classifyCohort({ id: 'u', createdAtMs: '2026-01-01T00:00:00Z' }, '2026-01-03T00:00:00Z'),
    ).toBe('new');
  });
});

describe('bucketByCohort (LM10)', () => {
  const subs: SubscriberSignals[] = [
    { id: 'new1', createdAtMs: daysAgo(2) },
    { id: 'trial1', createdAtMs: daysAgo(20), subscriptionStatus: 'trialing' },
    { id: 'active1', createdAtMs: daysAgo(200), lastActiveAtMs: daysAgo(5), plan: 'pro' },
    { id: 'churned1', createdAtMs: daysAgo(2), subscriptionStatus: 'canceled' },
    { id: 'dormant1', createdAtMs: daysAgo(200), lastActiveAtMs: daysAgo(60) },
  ];

  it('buckets ids into the right cohorts with all keys present', () => {
    const b = bucketByCohort(subs, NOW);
    expect(b.byCohort.new).toEqual(['new1']);
    expect(b.byCohort.trial).toEqual(['trial1']);
    expect(b.byCohort.active).toEqual(['active1']);
    expect(b.byCohort.churned).toEqual(['churned1']);
    expect(b.byCohort.dormant).toEqual(['dormant1']);
    expect(Object.keys(b.byCohort).sort()).toEqual([...LIFECYCLE_COHORTS].sort());
  });

  it('tallies counts + total', () => {
    const b = bucketByCohort(subs, NOW);
    expect(b.total).toBe(5);
    expect(b.counts.churned).toBe(1);
  });

  it('skips rows without an id and never throws on junk input', () => {
    const b = bucketByCohort(
      [{ id: '', createdAtMs: daysAgo(1) }, undefined as unknown as SubscriberSignals],
      NOW,
    );
    expect(b.total).toBe(0);
    expect(b.byCohort.new).toEqual([]);
  });
});
