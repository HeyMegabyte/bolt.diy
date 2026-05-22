/**
 * @module __tests__/cost-forecast
 * @description Tests for `GET /api/admin/forecast/cost` (item #95).
 *
 * Verifies that:
 *  1. The pure {@link computeForecast} math is deterministic and matches the
 *     documented Cloudflare pricing formulas.
 *  2. The route returns the expected category breakdown + LLM-driven tip.
 *  3. Auth is enforced.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));
jest.mock('../lib/sentry.js', () => ({ captureError: jest.fn(), captureMessage: jest.fn(), createSentry: jest.fn() }));
jest.mock('../lib/posthog.js', () => ({ capture: jest.fn(), trackAuth: jest.fn(), trackSite: jest.fn(), trackError: jest.fn() }));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { aiAdmin } from '../routes/ai_admin.js';
import { computeForecast } from '../services/ai_admin_features.js';

const ORG_ID = 'org-forecast-1';

interface FirstShape {
  ai_calls: number;
  ai_credits: number;
  bandwidth_bytes: number;
  storage_bytes: number;
  estimated_cost_micro_usd: number;
}

function makeDb(rollup: FirstShape, tokens: { ti: number; to_: number; calls: number }): D1Database {
  let callIdx = 0;
  return {
    prepare: jest.fn(() => ({
      bind: jest.fn(() => ({
        first: jest.fn().mockImplementation(() => {
          callIdx++;
          if (callIdx === 1) return Promise.resolve(rollup);
          return Promise.resolve(tokens);
        }),
        all: jest.fn().mockResolvedValue({ results: [], success: true }),
      })),
    })),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database, aiTip: string): Env {
  return {
    DB: db,
    CACHE_KV: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
    AI: { run: jest.fn().mockResolvedValue({ response: aiTip }) } as unknown as Ai,
    ENVIRONMENT: 'test',
  } as unknown as Env;
}

function authedApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    c.set('requestId', 'req-1');
    await next();
  });
  app.route('/', aiAdmin);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('computeForecast', () => {
  it('produces deterministic math for a known input', () => {
    const f = computeForecast({
      ai_calls: 0,
      ai_credits: 0,
      bandwidth_bytes: 0,
      storage_bytes: 10 * 1024 ** 3, // 10 GiB
      estimated_cost_micro_usd: 0,
      request_count: 1_000_000,
      ai_tokens: 1_000_000,
    });
    // workers = (1M/1M)*0.30 + (1M*5/1M)*0.02 = 0.30 + 0.10 = 0.40
    expect(f.by_category.workers).toBe(0.4);
    // ai = (1M/1K)*0.011 = 11
    expect(f.by_category.ai).toBe(11);
    // r2 = 10 * 0.015 = 0.15
    expect(f.by_category.r2).toBe(0.15);
    // d1 = max(0.01, 1M*50/1M) = 50
    expect(f.by_category.d1).toBe(50);
    // email = (1M/1K)*0.001 = 1
    expect(f.by_category.email).toBe(1);

    const total = 0.4 + 11 + 0.15 + 50 + 1;
    expect(f.current_month_estimate_usd).toBe(Math.round(total * 100) / 100);
    expect(f.next_month_forecast_usd).toBe(Math.round(total * 1.1 * 100) / 100);
    expect(f.biggest_driver).toBe('d1');
  });

  it('picks ai as biggest_driver when AI dominates', () => {
    const f = computeForecast({
      ai_calls: 0,
      ai_credits: 0,
      bandwidth_bytes: 0,
      storage_bytes: 0,
      estimated_cost_micro_usd: 0,
      request_count: 1000,
      ai_tokens: 10_000_000, // → $110 on AI
    });
    expect(f.biggest_driver).toBe('ai');
  });
});

describe('GET /api/admin/forecast/cost', () => {
  it('rejects unauthenticated requests', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.onError(errorHandler);
    app.route('/', aiAdmin);
    const env = makeEnv(makeDb({
      ai_calls: 0, ai_credits: 0, bandwidth_bytes: 0, storage_bytes: 0, estimated_cost_micro_usd: 0,
    }, { ti: 0, to_: 0, calls: 0 }), 'tip');
    const res = await app.request('/api/admin/forecast/cost', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns the forecast + LLM-driven savings tip', async () => {
    const db = makeDb(
      {
        ai_calls: 500,
        ai_credits: 1000,
        bandwidth_bytes: 0,
        storage_bytes: 2 * 1024 ** 3,
        estimated_cost_micro_usd: 100_000,
      },
      { ti: 50_000, to_: 50_000, calls: 500 },
    );
    const env = makeEnv(db, 'Move infrequent R2 reads to IA storage class to save 30%.');
    const res = await authedApp().request('/api/admin/forecast/cost', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        current_month_estimate_usd: number;
        next_month_forecast_usd: number;
        by_category: Record<string, number>;
        biggest_driver: string;
        savings_tip: string;
      };
    };
    expect(typeof body.data.current_month_estimate_usd).toBe('number');
    expect(typeof body.data.next_month_forecast_usd).toBe('number');
    expect(body.data.by_category).toEqual(
      expect.objectContaining({
        workers: expect.any(Number),
        ai: expect.any(Number),
        r2: expect.any(Number),
        d1: expect.any(Number),
        email: expect.any(Number),
      }),
    );
    expect(body.data.savings_tip).toContain('IA storage');
    expect(env.AI.run).toHaveBeenCalledTimes(1);
    const args = (env.AI.run as jest.Mock).mock.calls[0]!;
    expect(args[0]).toBe('@cf/meta/llama-3.3-70b-instruct');
  });
});
