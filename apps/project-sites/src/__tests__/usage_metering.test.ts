/**
 * @module __tests__/usage_metering
 * @description Unit coverage for the usage-metering pipeline
 * ({@link recordUsage}, {@link getMonthUsage}, {@link getOrgTier},
 * {@link computeOverageMicroUsd}, {@link parseUsagePriceIds},
 * {@link dispatchUsageToStripe}, the three meter* wrappers,
 * {@link getUsagePanelPayload}, {@link aggregateNightly}, and
 * {@link currentMonthPeriod}). D1 and the Stripe REST API (global `fetch`) are
 * mocked so these exercise the branch surface — value guards, per-period sum
 * aggregation, tier resolution, overage math with per-GB rounding, env parsing,
 * Stripe usage-record push + billed-flag flip, idempotency, org+metric scoping,
 * near-limit detection, and error resilience — not the integrations themselves.
 *
 * Convergence r28 — additive spec; no source changes.
 */

jest.mock('../services/db.js', () => ({
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbQuery: jest.fn().mockResolvedValue({ data: [] }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbInsert, dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import {
  currentMonthPeriod,
  recordUsage,
  getMonthUsage,
  getOrgTier,
  computeOverageMicroUsd,
  parseUsagePriceIds,
  dispatchUsageToStripe,
  meterAiCall,
  meterImageGeneration,
  meterEgressBytes,
  getUsagePanelPayload,
  aggregateNightly,
} from '../services/usage_metering.js';
import { USAGE_TIERS, OVERAGE_MICRO_USD } from '../constants/pricing.js';
import type { Env } from '../types/env.js';

const mockInsert = dbInsert as unknown as jest.Mock;
const mockQuery = dbQuery as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockUpdate = dbUpdate as unknown as jest.Mock;

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
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
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
    await recordUsage(baseEnv, db, { orgId: ORG, metric: 'ai_calls', value: 3.9, siteId: 'site-1' });
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

  it('swallows D1 write failures without throwing', async () => {
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

  it('returns free when status is not active', async () => {
    mockQueryOne.mockResolvedValue({ plan: 'paid', status: 'past_due' });
    expect(await getOrgTier(db, ORG)).toBe('free');
  });

  it('returns pro for an active paid subscription', async () => {
    mockQueryOne.mockResolvedValue({ plan: 'paid', status: 'active' });
    expect(await getOrgTier(db, ORG)).toBe('pro');
  });
});

describe('computeOverageMicroUsd', () => {
  it('returns zero overage when usage is within inclusions', async () => {
    mockQueryOne.mockImplementation(usageSumImpl({ ai_calls: 10, bytes_egress: 1024, image_generations: 1 }));
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
      usageSumImpl({ ai_calls: 1000, bytes_egress: 1 * GB + Math.floor(2.4 * GB), image_generations: 50 }),
    );
    const out = await computeOverageMicroUsd(db, ORG, 'free');
    // 2.4 GB over → ceil → 3 GB
    expect(out.total_micro_usd).toBe(3 * OVERAGE_MICRO_USD.bytes_egress_per_gb);
  });

  it('floors negative deltas at zero per metric', async () => {
    mockQueryOne.mockImplementation(usageSumImpl({ ai_calls: 0, bytes_egress: 0, image_generations: 0 }));
    const out = await computeOverageMicroUsd(db, ORG, 'scale');
    expect(out.total_micro_usd).toBe(0);
  });
});

describe('parseUsagePriceIds', () => {
  it('returns null when env var is missing', () => {
    expect(parseUsagePriceIds({} as unknown as Env)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(parseUsagePriceIds({ STRIPE_USAGE_PRICE_IDS: '{not json' } as unknown as Env)).toBeNull();
  });

  it('returns null when a metric price id is missing', () => {
    const env = {
      STRIPE_USAGE_PRICE_IDS: JSON.stringify({ ai_calls: 'price_a', bytes_egress: 'price_b' }),
    } as unknown as Env;
    expect(parseUsagePriceIds(env)).toBeNull();
  });

  it('returns null when a metric price id is an empty string', () => {
    const env = {
      STRIPE_USAGE_PRICE_IDS: JSON.stringify({
        ai_calls: 'price_a',
        bytes_egress: '',
        image_generations: 'price_c',
      }),
    } as unknown as Env;
    expect(parseUsagePriceIds(env)).toBeNull();
  });

  it('returns the full map when all metric price ids are present', () => {
    const env = {
      STRIPE_USAGE_PRICE_IDS: JSON.stringify({
        ai_calls: 'price_a',
        bytes_egress: 'price_b',
        image_generations: 'price_c',
        extra: 'ignored',
      }),
    } as unknown as Env;
    expect(parseUsagePriceIds(env)).toEqual({
      ai_calls: 'price_a',
      bytes_egress: 'price_b',
      image_generations: 'price_c',
    });
  });

  it('ignores non-string metric values', () => {
    const env = {
      STRIPE_USAGE_PRICE_IDS: JSON.stringify({ ai_calls: 123, bytes_egress: 'b', image_generations: 'c' }),
    } as unknown as Env;
    expect(parseUsagePriceIds(env)).toBeNull();
  });
});

describe('dispatchUsageToStripe', () => {
  const priceEnv = {
    DB: db,
    STRIPE_SECRET_KEY: 'sk_test_123',
    STRIPE_USAGE_PRICE_IDS: JSON.stringify({
      ai_calls: 'price_ai',
      bytes_egress: 'price_eg',
      image_generations: 'price_img',
    }),
  } as unknown as Env;

  afterEach(() => {
    // @ts-expect-error test teardown
    delete global.fetch;
  });

  it('skips with tier_free for a free org', async () => {
    mockQueryOne.mockResolvedValue(null); // getOrgTier → free
    const out = await dispatchUsageToStripe(priceEnv, db, ORG);
    expect(out).toEqual({ dispatched: 0, skipped_reason: 'tier_free' });
  });

  it('skips with no_price_ids when env is unconfigured', async () => {
    mockQueryOne.mockResolvedValue({ plan: 'paid', status: 'active' }); // pro
    const out = await dispatchUsageToStripe(baseEnv, db, ORG);
    expect(out).toEqual({ dispatched: 0, skipped_reason: 'no_price_ids' });
  });

  it('skips with no_subscription when org has no stripe_subscription_id', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' }) // getOrgTier
      .mockResolvedValueOnce({ stripe_subscription_id: null }); // subscription lookup
    const out = await dispatchUsageToStripe(priceEnv, db, ORG);
    expect(out).toEqual({ dispatched: 0, skipped_reason: 'no_subscription' });
  });

  it('skips with items_<status> when the subscription_items fetch fails', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' })
      .mockResolvedValueOnce({ stripe_subscription_id: 'sub_1' });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    const out = await dispatchUsageToStripe(priceEnv, db, ORG);
    expect(out).toEqual({ dispatched: 0, skipped_reason: 'items_403' });
  });

  it('dispatches each metric with a positive unbilled total and flips billed=1', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' }) // getOrgTier
      .mockResolvedValueOnce({ stripe_subscription_id: 'sub_1' }) // subscription lookup
      // three per-metric unbilled sums (USAGE_METRICS order: ai_calls, bytes_egress, image_generations)
      .mockResolvedValueOnce({ total: 42 })
      .mockResolvedValueOnce({ total: 1000 })
      .mockResolvedValueOnce({ total: 5 });

    const fetchMock = jest
      .fn()
      // subscription_items list
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'si_ai', price: { id: 'price_ai' } },
            { id: 'si_eg', price: { id: 'price_eg' } },
            { id: 'si_img', price: { id: 'price_img' } },
          ],
        }),
      })
      // three usage_record POSTs
      .mockResolvedValue({ ok: true, json: async () => ({}), text: async () => '' });
    global.fetch = fetchMock;

    const out = await dispatchUsageToStripe(priceEnv, db, ORG);
    expect(out).toEqual({ dispatched: 3 });
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    // first POST goes to the ai subscription_item usage_records endpoint
    const postUrls = fetchMock.mock.calls.slice(1).map((c) => c[0] as string);
    expect(postUrls[0]).toContain('/v1/subscription_items/si_ai/usage_records');
  });

  it('skips a metric when its subscription_item is not present', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' })
      .mockResolvedValueOnce({ stripe_subscription_id: 'sub_1' })
      .mockResolvedValueOnce({ total: 10 }); // ai_calls sum (only the ai item exists)

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'si_ai', price: { id: 'price_ai' } }] }),
      })
      .mockResolvedValue({ ok: true, json: async () => ({}), text: async () => '' });
    global.fetch = fetchMock;

    const out = await dispatchUsageToStripe(priceEnv, db, ORG);
    expect(out).toEqual({ dispatched: 1 });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('skips a metric whose unbilled total is zero (no double-charge)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' })
      .mockResolvedValueOnce({ stripe_subscription_id: 'sub_1' })
      .mockResolvedValueOnce({ total: 0 }) // ai_calls
      .mockResolvedValueOnce({ total: 0 }) // bytes_egress
      .mockResolvedValueOnce({ total: 0 }); // image_generations

    const fetchMock = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'si_ai', price: { id: 'price_ai' } },
          { id: 'si_eg', price: { id: 'price_eg' } },
          { id: 'si_img', price: { id: 'price_img' } },
        ],
      }),
    });
    global.fetch = fetchMock;

    const out = await dispatchUsageToStripe(priceEnv, db, ORG);
    expect(out).toEqual({ dispatched: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
    // only the items-list fetch fired; no usage_record POSTs
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('continues past a failed usage_record POST without flipping billed', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' })
      .mockResolvedValueOnce({ stripe_subscription_id: 'sub_1' })
      .mockResolvedValueOnce({ total: 7 }) // ai_calls
      .mockResolvedValueOnce({ total: 0 }) // bytes_egress
      .mockResolvedValueOnce({ total: 0 }); // image_generations

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'si_ai', price: { id: 'price_ai' } },
            { id: 'si_eg', price: { id: 'price_eg' } },
            { id: 'si_img', price: { id: 'price_img' } },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'stripe boom' });
    global.fetch = fetchMock;

    const out = await dispatchUsageToStripe(priceEnv, db, ORG);
    expect(out).toEqual({ dispatched: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('treats a null unbilled SUM as zero', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' })
      .mockResolvedValueOnce({ stripe_subscription_id: 'sub_1' })
      .mockResolvedValueOnce({ total: null }) // ai_calls
      .mockResolvedValueOnce({ total: null }) // bytes_egress
      .mockResolvedValueOnce({ total: null }); // image_generations

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'si_ai', price: { id: 'price_ai' } },
          { id: 'si_eg', price: { id: 'price_eg' } },
          { id: 'si_img', price: { id: 'price_img' } },
        ],
      }),
    });

    const out = await dispatchUsageToStripe(priceEnv, db, ORG);
    expect(out).toEqual({ dispatched: 0 });
  });
});

describe('meter* wrappers', () => {
  it('meterAiCall records one ai_call', async () => {
    await meterAiCall(baseEnv, db, ORG, 'site-x');
    expect(mockInsert.mock.calls[0][2]).toMatchObject({ metric: 'ai_calls', value: 1, site_id: 'site-x' });
  });

  it('meterImageGeneration records one image_generation', async () => {
    await meterImageGeneration(baseEnv, db, ORG);
    expect(mockInsert.mock.calls[0][2]).toMatchObject({ metric: 'image_generations', value: 1 });
  });

  it('meterEgressBytes records the byte count', async () => {
    await meterEgressBytes(baseEnv, db, ORG, 2048, 'site-y');
    expect(mockInsert.mock.calls[0][2]).toMatchObject({ metric: 'bytes_egress', value: 2048 });
  });

  it('meterEgressBytes no-ops on zero bytes (guard)', async () => {
    await meterEgressBytes(baseEnv, db, ORG, 0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('meterEgressBytes no-ops on negative bytes (guard)', async () => {
    await meterEgressBytes(baseEnv, db, ORG, -1);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('getUsagePanelPayload', () => {
  it('rolls tier + inclusions + usage + overage into one payload', async () => {
    // 1st queryOne → getOrgTier (free), then 3 → getMonthUsage, then 3 → computeOverage's getMonthUsage
    mockQueryOne
      .mockResolvedValueOnce(null) // getOrgTier → free
      .mockImplementation(usageSumImpl({ ai_calls: 100, bytes_egress: 1024, image_generations: 1 }));
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
