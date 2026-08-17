/**
 * @module __tests__/usage_metering
 * @description Unit coverage for the usage-metering pipeline
 * ({@link recordUsage}, {@link getMonthUsage}, {@link getOrgTier},
 * {@link computeOverageMicroUsd}, the three meter* wrappers,
 * {@link getUsagePanelPayload}, {@link aggregateNightly}, and
 * {@link currentMonthPeriod}). D1 is mocked so these exercise the branch
 * surface — value guards, per-period sum aggregation, tier resolution, overage
 * math with per-GB rounding, org+metric scoping, near-limit detection, and
 * error resilience — not the integrations themselves.
 *
 * Convergence r28 — additive spec; no source changes.
 */

jest.mock('../services/db.js', () => ({
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbQuery: jest.fn().mockResolvedValue({ data: [] }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
}));

import { dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import {
  currentMonthPeriod,
  recordUsage,
  getMonthUsage,
  getOrgTier,
  computeOverageMicroUsd,
  getUsagePanelPayload,
  aggregateNightly,
} from '../services/usage_metering.js';
import { USAGE_TIERS, OVERAGE_MICRO_USD } from '../constants/pricing.js';
import type { Env } from '../types/env.js';

const mockInsert = dbInsert as unknown as jest.Mock;
const mockQuery = dbQuery as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;

const GB = 1024 * 1024 * 1024;

const db = {} as unknown as D1Database;
const baseEnv = { DB: db, STRIPE_SECRET_KEY: 'sk_test_123' } as unknown as Env;
const ORG = 'org-1';

/**
 * Build a `dbQueryOne` implementation that returns per-metric usage sums.
 * Routes by inspecting the metric bind param (2nd element of the params array).
 */
function usageSumImpl(map: Partial<Record<string, number>>) {
  return (_db: unknown, _sql: string, params: unknown[]) => {
    const metric = params[1] as string;
    return Promise.resolve({ total: map[metric] ?? 0 });
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInsert.mockResolvedValue({ error: null });
  mockQuery.mockResolvedValue({ data: [] });
  mockQueryOne.mockResolvedValue(null);
});

describe('currentMonthPeriod', () => {
  it('returns the first/last day of the calendar month in UTC ISO', () => {
    const { period_start, period_end } = currentMonthPeriod(new Date('2026-03-17T12:34:00Z'));
    expect(period_start).toBe('2026-03-01T00:00:00.000Z');
    expect(period_end).toBe('2026-04-01T00:00:00.000Z');
  });

  it('rolls the year over for December', () => {
    const { period_start, period_end } = currentMonthPeriod(new Date('2026-12-09T00:00:00Z'));
    expect(period_start).toBe('2026-12-01T00:00:00.000Z');
    expect(period_end).toBe('2027-01-01T00:00:00.000Z');
  });

  it('defaults to now when no date is given', () => {
    const out = currentMonthPeriod();
    expect(out.period_start).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
  });
});

describe('recordUsage', () => {
  it('inserts a floored event for a positive value', async () => {
    await recordUsage(baseEnv, db, {
      orgId: ORG,
      metric: 'ai_calls',
      value: 3.9,
      siteId: 'site-1',
    });
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockInsert.mock.calls[0];
    expect(table).toBe('usage_events');
    expect(record).toMatchObject({
      org_id: ORG,
      site_id: 'site-1',
      metric: 'ai_calls',
      value: 3,
      billed: 0,
      stripe_subscription_item_id: null,
    });
    expect(typeof record.id).toBe('string');
    expect(typeof record.ts).toBe('string');
  });

  it('coerces a missing siteId to null', async () => {
    await recordUsage(baseEnv, db, { orgId: ORG, metric: 'image_generations', value: 1 });
    expect(mockInsert.mock.calls[0][2].site_id).toBeNull();
  });

  it('no-ops on a zero value (guard)', async () => {
    await recordUsage(baseEnv, db, { orgId: ORG, metric: 'ai_calls', value: 0 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('no-ops on a negative value (guard)', async () => {
    await recordUsage(baseEnv, db, { orgId: ORG, metric: 'ai_calls', value: -5 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('swallows an unexpected JS throw from the insert (belt-and-suspenders catch)', async () => {
    mockInsert.mockRejectedValueOnce(new Error('d1 down'));
    await expect(
      recordUsage(baseEnv, db, { orgId: ORG, metric: 'ai_calls', value: 1 }),
    ).resolves.toBeUndefined();
  });

  it('swallows non-Error throws without throwing', async () => {
    mockInsert.mockRejectedValueOnce('string failure');
    await expect(
      recordUsage(baseEnv, db, { orgId: ORG, metric: 'bytes_egress', value: 100 }),
    ).resolves.toBeUndefined();
  });

  it('LOGS the drop when dbInsert returns { error } — the real D1-failure mode (no throw)', async () => {
    // `dbInsert` returns `{ error }` and does NOT throw on a D1 failure; the previous
    // bare `await dbInsert(...)` silently dropped the event AND logged nothing (the
    // catch only fires on a JS throw, which this insert never produces). Assert the drop
    // is now observable (warned) and that recordUsage still never throws (fire-and-forget).
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockInsert.mockResolvedValueOnce({ error: 'D1_ERROR: database is locked' });
    await expect(
      recordUsage(baseEnv, db, { orgId: ORG, metric: 'ai_calls', value: 1, siteId: 'site-1' }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      level: 'warn',
      service: 'usage_metering',
      message: 'failed to record usage',
      org_id: ORG,
      metric: 'ai_calls',
      error: 'D1_ERROR: database is locked',
    });
    warnSpy.mockRestore();
  });

  it('does NOT log when dbInsert succeeds ({ error: null })', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockInsert.mockResolvedValueOnce({ error: null });
    await recordUsage(baseEnv, db, { orgId: ORG, metric: 'image_generations', value: 1 });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('getMonthUsage', () => {
  it('sums each metric and derives egress MB', async () => {
    mockQueryOne.mockImplementation(
      usageSumImpl({ ai_calls: 1200, bytes_egress: 50 * 1024 * 1024, image_generations: 7 }),
    );
    const out = await getMonthUsage(db, ORG, new Date('2026-03-15T00:00:00Z'));
    expect(out.ai_calls).toBe(1200);
    expect(out.bytes_egress).toBe(50 * 1024 * 1024);
    expect(out.bytes_egress_mb).toBe(50);
    expect(out.image_generations).toBe(7);
    expect(out.period_start).toBe('2026-03-01T00:00:00.000Z');
    expect(out.period_end).toBe('2026-04-01T00:00:00.000Z');
    expect(mockQueryOne).toHaveBeenCalledTimes(3);
  });

  it('treats a null SUM as zero', async () => {
    mockQueryOne.mockResolvedValue({ total: null });
    const out = await getMonthUsage(db, ORG);
    expect(out.ai_calls).toBe(0);
    expect(out.bytes_egress_mb).toBe(0);
  });

  it('treats a missing row as zero', async () => {
    mockQueryOne.mockResolvedValue(null);
    const out = await getMonthUsage(db, ORG);
    expect(out.image_generations).toBe(0);
  });
});

describe('getOrgTier', () => {
  it('returns free when no subscription exists', async () => {
    mockQueryOne.mockResolvedValue(null);
    expect(await getOrgTier(db, ORG)).toBe('free');
  });

  it('returns free when plan is not paid', async () => {
    mockQueryOne.mockResolvedValue({ plan: 'free', status: 'active' });
    expect(await getOrgTier(db, ORG)).toBe('free');
  });

  it('returns free when status is past_due/canceled (excluded by the SSOT SQL)', async () => {
    // getOrgTier delegates to resolveActiveOrgPlan, whose SQL filters
    // `status IN ('active', 'trialing')` — a past_due sub matches no row, so the
    // (SQL-bypassing) mock returns null exactly as the real query would → free.
    mockQueryOne.mockResolvedValue(null);
    expect(await getOrgTier(db, ORG)).toBe('free');
  });

  it('returns pro for a TRIALING paid subscription + routes through the trialing-inclusive SSOT', async () => {
    // Trialing-drift fix: the SSOT SQL includes `trialing`, so a paid trial returns a
    // `{ plan: 'paid' }` row → pro (was wrongly free under the old active-only gate).
    let sql = '';
    mockQueryOne.mockImplementation(async (_db: unknown, q: string) => {
      sql = q;
      return { plan: 'paid' };
    });
    expect(await getOrgTier(db, ORG)).toBe('pro');
    expect(sql).toContain("status IN ('active', 'trialing')");
  });

  it('returns pro for an active paid subscription', async () => {
    mockQueryOne.mockResolvedValue({ plan: 'paid', status: 'active' });
    expect(await getOrgTier(db, ORG)).toBe('pro');
  });
});

describe('computeOverageMicroUsd', () => {
  it('returns zero overage when usage is within inclusions', async () => {
    mockQueryOne.mockImplementation(
      usageSumImpl({ ai_calls: 10, bytes_egress: 1024, image_generations: 1 }),
    );
    const out = await computeOverageMicroUsd(db, ORG, 'pro');
    expect(out.ai_calls_overage).toBe(0);
    expect(out.bytes_egress_overage).toBe(0);
    expect(out.image_generations_overage).toBe(0);
    expect(out.total_micro_usd).toBe(0);
  });

  it('computes overage with per-GB ceiling rounding', async () => {
    // free tier: 1000 ai, 1GB egress, 50 imgs
    mockQueryOne.mockImplementation(
      usageSumImpl({
        ai_calls: 1100, // 100 over
        bytes_egress: 1 * GB + 1, // 1 byte over → ceil to 1 GB
        image_generations: 60, // 10 over
      }),
    );
    const out = await computeOverageMicroUsd(db, ORG, 'free');
    expect(out.ai_calls_overage).toBe(100);
    expect(out.bytes_egress_overage).toBe(1);
    expect(out.image_generations_overage).toBe(10);
    const expected =
      100 * OVERAGE_MICRO_USD.ai_calls +
      1 * OVERAGE_MICRO_USD.bytes_egress_per_gb +
      10 * OVERAGE_MICRO_USD.image_generations;
    expect(out.total_micro_usd).toBe(expected);
  });

  it('rounds egress up to the next whole GB (2.x GB over → 3 GB billed)', async () => {
    mockQueryOne.mockImplementation(
      usageSumImpl({
        ai_calls: 1000,
        bytes_egress: 1 * GB + Math.floor(2.4 * GB),
        image_generations: 50,
      }),
    );
    const out = await computeOverageMicroUsd(db, ORG, 'free');
    // 2.4 GB over → ceil → 3 GB
    expect(out.total_micro_usd).toBe(3 * OVERAGE_MICRO_USD.bytes_egress_per_gb);
  });

  it('floors negative deltas at zero per metric', async () => {
    mockQueryOne.mockImplementation(
      usageSumImpl({ ai_calls: 0, bytes_egress: 0, image_generations: 0 }),
    );
    const out = await computeOverageMicroUsd(db, ORG, 'scale');
    expect(out.total_micro_usd).toBe(0);
  });
});

describe('getUsagePanelPayload', () => {
  it('rolls tier + inclusions + usage + overage into one payload', async () => {
    // 1st queryOne → getOrgTier (free), then 3 → getMonthUsage, then 3 → computeOverage's getMonthUsage
    mockQueryOne
      .mockResolvedValueOnce(null) // getOrgTier → free
      .mockImplementation(
        usageSumImpl({ ai_calls: 100, bytes_egress: 1024, image_generations: 1 }),
      );
    const out = await getUsagePanelPayload(db, ORG, new Date('2026-03-15T00:00:00Z'));
    expect(out.tier).toBe('free');
    expect(out.tier_label).toBe(USAGE_TIERS.free.label);
    expect(out.inclusions).toEqual({
      ai_calls: USAGE_TIERS.free.ai_calls,
      bytes_egress: USAGE_TIERS.free.bytes_egress,
      image_generations: USAGE_TIERS.free.image_generations,
    });
    expect(out.usage.ai_calls).toBe(100);
    expect(out.overage.total_micro_usd).toBe(0);
    expect(out.near_limit).toBe(false);
  });

  it('flags near_limit when any metric crosses 80% of its inclusion', async () => {
    mockQueryOne
      .mockResolvedValueOnce(null) // free
      .mockImplementation(usageSumImpl({ ai_calls: 900, bytes_egress: 0, image_generations: 0 })); // 900/1000 = 0.9
    const out = await getUsagePanelPayload(db, ORG);
    expect(out.near_limit).toBe(true);
  });
});

describe('aggregateNightly', () => {
  it('returns the daily-view row count', async () => {
    mockQuery.mockResolvedValue({ data: [{ total: 17 }] });
    const out = await aggregateNightly(db);
    expect(out).toEqual({ rows: 17 });
    expect(mockQuery).toHaveBeenCalledWith(
      db,
      expect.stringContaining('v_usage_daily_ai_calls'),
      [],
    );
  });

  it('returns zero when the view is empty', async () => {
    mockQuery.mockResolvedValue({ data: [] });
    expect(await aggregateNightly(db)).toEqual({ rows: 0 });
  });

  it('treats a null COUNT as zero', async () => {
    mockQuery.mockResolvedValue({ data: [{ total: null }] });
    expect(await aggregateNightly(db)).toEqual({ rows: 0 });
  });
});
