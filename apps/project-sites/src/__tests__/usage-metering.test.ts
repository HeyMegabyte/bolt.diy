/**
 * Tests for src/services/usage_metering.ts (item #99).
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import {
  recordUsage,
  getMonthUsage,
  computeOverageMicroUsd,
  parseUsagePriceIds,
  dispatchUsageToStripe,
  getUsagePanelPayload,
  meterAiCall,
  USAGE_TIERS,
} from '../services/usage_metering.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

const mockDb = {} as D1Database;
const env = { STRIPE_SECRET_KEY: 'sk_test_xxx' } as unknown as import('../types/env.js').Env;
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('recordUsage', () => {
  it('inserts a usage_events row', async () => {
    await recordUsage(env, mockDb, { orgId: 'org-1', metric: 'ai_calls', value: 3 });
    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'usage_events',
      expect.objectContaining({
        org_id: 'org-1',
        metric: 'ai_calls',
        value: 3,
        billed: 0,
      }),
    );
  });

  it('skips zero/negative values', async () => {
    await recordUsage(env, mockDb, { orgId: 'org-1', metric: 'ai_calls', value: 0 });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('never throws when D1 fails', async () => {
    mockInsert.mockRejectedValueOnce(new Error('D1 failure'));
    await expect(
      recordUsage(env, mockDb, { orgId: 'org-1', metric: 'ai_calls', value: 1 }),
    ).resolves.toBeUndefined();
  });

  it('meterAiCall increments by 1', async () => {
    await meterAiCall(env, mockDb, 'org-1');
    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'usage_events',
      expect.objectContaining({ metric: 'ai_calls', value: 1 }),
    );
  });
});

describe('getMonthUsage', () => {
  it('aggregates totals per metric', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: 250 })
      .mockResolvedValueOnce({ total: 10 * 1024 * 1024 }) // 10 MB
      .mockResolvedValueOnce({ total: 5 });
    const usage = await getMonthUsage(mockDb, 'org-1');
    expect(usage.ai_calls).toBe(250);
    expect(usage.bytes_egress).toBe(10 * 1024 * 1024);
    expect(usage.bytes_egress_mb).toBe(10);
    expect(usage.image_generations).toBe(5);
    expect(usage.period_start).toMatch(/T00:00:00.000Z$/);
  });
});

describe('computeOverageMicroUsd', () => {
  it('returns zero overage when under tier caps', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ total: 100 })
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 0 });
    const result = await computeOverageMicroUsd(mockDb, 'org-1', 'free');
    expect(result.total_micro_usd).toBe(0);
  });

  it('charges overages against the tier cap', async () => {
    // Free tier: 1000 ai_calls, 1 GB egress, 50 image_gens.
    // Send 2000 ai_calls (1000 over), 2 GB egress (1 GB over rounded up),
    // 70 image_gens (20 over).
    mockQueryOne
      .mockResolvedValueOnce({ total: 2000 })
      .mockResolvedValueOnce({ total: 2 * 1024 * 1024 * 1024 })
      .mockResolvedValueOnce({ total: 70 });
    const result = await computeOverageMicroUsd(mockDb, 'org-1', 'free');
    expect(result.ai_calls_overage).toBe(1000);
    expect(result.image_generations_overage).toBe(20);
    // 1000 * 500 + 1 * 50_000 + 20 * 50_000 = 500_000 + 50_000 + 1_000_000 = 1_550_000
    expect(result.total_micro_usd).toBe(1_550_000);
  });
});

describe('parseUsagePriceIds', () => {
  it('returns null when env var is missing', () => {
    expect(parseUsagePriceIds(env)).toBeNull();
  });

  it('returns parsed price ids when all three metrics are present', () => {
    const e = {
      ...env,
      STRIPE_USAGE_PRICE_IDS: JSON.stringify({
        ai_calls: 'price_a',
        bytes_egress: 'price_b',
        image_generations: 'price_c',
      }),
    } as unknown as import('../types/env.js').Env;
    expect(parseUsagePriceIds(e)).toEqual({
      ai_calls: 'price_a',
      bytes_egress: 'price_b',
      image_generations: 'price_c',
    });
  });

  it('returns null when a metric is missing', () => {
    const e = {
      ...env,
      STRIPE_USAGE_PRICE_IDS: JSON.stringify({ ai_calls: 'price_a' }),
    } as unknown as import('../types/env.js').Env;
    expect(parseUsagePriceIds(e)).toBeNull();
  });
});

describe('dispatchUsageToStripe', () => {
  it('skips when tier is free', async () => {
    mockQueryOne.mockResolvedValueOnce({ plan: 'free', status: 'active' });
    const result = await dispatchUsageToStripe(env, mockDb, 'org-1');
    expect(result.skipped_reason).toBe('tier_free');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips when STRIPE_USAGE_PRICE_IDS missing', async () => {
    mockQueryOne.mockResolvedValueOnce({ plan: 'paid', status: 'active' });
    const result = await dispatchUsageToStripe(env, mockDb, 'org-1');
    expect(result.skipped_reason).toBe('no_price_ids');
  });

  it('forwards aggregated usage records to Stripe and marks rows billed', async () => {
    const e = {
      ...env,
      STRIPE_USAGE_PRICE_IDS: JSON.stringify({
        ai_calls: 'price_a',
        bytes_egress: 'price_b',
        image_generations: 'price_c',
      }),
    } as unknown as import('../types/env.js').Env;

    mockQueryOne
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' }) // getOrgTier → pro
      .mockResolvedValueOnce({ stripe_subscription_id: 'sub_xxx' }) // subscription lookup
      .mockResolvedValueOnce({ total: 42 }) // ai_calls
      .mockResolvedValueOnce({ total: 0 }) // bytes_egress unbilled
      .mockResolvedValueOnce({ total: 7 }); // image_generations

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'si_a', price: { id: 'price_a' } },
            { id: 'si_b', price: { id: 'price_b' } },
            { id: 'si_c', price: { id: 'price_c' } },
          ],
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => '' });

    const result = await dispatchUsageToStripe(e, mockDb, 'org-1');
    expect(result.dispatched).toBe(2);
    // mockUpdate called twice (once per non-zero metric)
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'usage_events',
      expect.objectContaining({ billed: 1, stripe_subscription_item_id: 'si_a' }),
      'org_id = ? AND metric = ? AND billed = 0',
      ['org-1', 'ai_calls'],
    );
  });
});

describe('getUsagePanelPayload', () => {
  it('marks near_limit when ≥80% of any cap is consumed', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ plan: 'free', status: 'active' })
      .mockResolvedValueOnce({ total: 850 }) // ai_calls @ 85% of free
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 0 })
      // computeOverageMicroUsd does another getMonthUsage call internally.
      .mockResolvedValueOnce({ total: 850 })
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({ total: 0 });
    const payload = await getUsagePanelPayload(mockDb, 'org-1');
    expect(payload.tier).toBe('free');
    expect(payload.near_limit).toBe(true);
    expect(payload.inclusions.ai_calls).toBe(USAGE_TIERS.free.ai_calls);
  });
});
