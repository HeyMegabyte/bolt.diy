/**
 * Stage 4.2c — per-site daily-cap impure helpers (AE count + KV flag). The pure
 * bits (keys, TTL, SQL) live in functions_guardrails.test.ts; this locks the wiring:
 * the fire-and-forget AE write, the fail-open hot-path flag read, the 429 body, and
 * the cron that turns AE counts into per-site KV flags (all fail-soft).
 */
jest.mock('../services/cf_analytics.js', () => ({
  recordEvent: jest.fn(),
  querySql: jest.fn(),
}));

import {
  recordFunctionsDispatch,
  isSiteOverDailyCap,
  overCapResponse,
  enforceFunctionsDailyCaps,
} from '../services/functions_daily_cap.js';
import { recordEvent, querySql } from '../services/cf_analytics.js';
import type { Env } from '../types/env.js';

const mockRecord = recordEvent as unknown as jest.Mock;
const mockQuery = querySql as unknown as jest.Mock;

function kvEnv(overrides: Record<string, unknown> = {}): {
  env: Env;
  gets: Map<string, string>;
  puts: { key: string; value: string; ttl?: number }[];
} {
  const gets = new Map<string, string>();
  const puts: { key: string; value: string; ttl?: number }[] = [];
  const env = {
    CACHE_KV: {
      get: jest.fn(async (k: string) => gets.get(k) ?? null),
      put: jest.fn(async (k: string, v: string, opts?: { expirationTtl?: number }) => {
        puts.push({ key: k, value: v, ttl: opts?.expirationTtl });
      }),
    },
    CF_ACCOUNT_ID: 'acct',
    CF_API_TOKEN: 'tok',
    ...overrides,
  } as unknown as Env;
  return { env, gets, puts };
}

beforeEach(() => {
  mockRecord.mockReset();
  mockQuery.mockReset();
});

describe('recordFunctionsDispatch', () => {
  it('writes one fn_dispatch AE data point tagged with the site + org', () => {
    const { env } = kvEnv();
    recordFunctionsDispatch(env, 'abc', 'org1', '/api/hello');
    expect(mockRecord).toHaveBeenCalledWith(env, {
      event: 'fn_dispatch',
      siteId: 'abc',
      orgId: 'org1',
      routePath: '/api/hello',
    });
  });

  it('never throws even if the AE write throws (fail-open)', () => {
    const { env } = kvEnv();
    mockRecord.mockImplementation(() => {
      throw new Error('AE down');
    });
    expect(() => recordFunctionsDispatch(env, 'abc', 'org1', '/api/x')).not.toThrow();
  });
});

describe('isSiteOverDailyCap', () => {
  it('true when the fn_overcap flag is present', async () => {
    const { env, gets } = kvEnv();
    gets.set('fn_overcap:abc', '1');
    expect(await isSiteOverDailyCap(env, 'abc')).toBe(true);
  });

  it('false when the flag is absent', async () => {
    const { env } = kvEnv();
    expect(await isSiteOverDailyCap(env, 'abc')).toBe(false);
  });

  it('fails OPEN (false) when CACHE_KV is missing or throws', async () => {
    expect(await isSiteOverDailyCap({} as unknown as Env, 'abc')).toBe(false);
    const env = {
      CACHE_KV: {
        get: jest.fn(async () => {
          throw new Error('kv fault');
        }),
      },
    } as unknown as Env;
    expect(await isSiteOverDailyCap(env, 'abc')).toBe(false);
  });
});

describe('overCapResponse', () => {
  it('is a 429 RATE_LIMITED envelope with a retry-after to UTC midnight', async () => {
    const res = overCapResponse(new Date('2026-01-01T23:59:00Z'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('content-type')).toBe('application/json');
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.message).toMatch(/daily request limit/i);
  });
});

describe('enforceFunctionsDailyCaps', () => {
  it('flags every site the AE query returns over cap, with a TTL to UTC midnight', async () => {
    const { env, puts } = kvEnv();
    mockQuery.mockResolvedValue([
      { site_id: 's1', n: 120000 },
      { site_id: 's2', n: 100000 },
    ]);
    const flagged = await enforceFunctionsDailyCaps(env, 100_000, new Date('2026-01-01T12:00:00Z'));
    expect(flagged).toBe(2);
    expect(puts).toEqual([
      { key: 'fn_overcap:s1', value: '1', ttl: 43200 },
      { key: 'fn_overcap:s2', value: '1', ttl: 43200 },
    ]);
    // the query it ran is the cap SQL
    expect(mockQuery.mock.calls[0][1]).toContain("blob1 = 'fn_dispatch'");
  });

  it('flags nothing when no site is over cap', async () => {
    const { env, puts } = kvEnv();
    mockQuery.mockResolvedValue([]);
    expect(await enforceFunctionsDailyCaps(env)).toBe(0);
    expect(puts).toHaveLength(0);
  });

  it('skips a row with an empty/sentinel site_id', async () => {
    const { env, puts } = kvEnv();
    mockQuery.mockResolvedValue([
      { site_id: '-', n: 999999 },
      { site_id: '', n: 999999 },
    ]);
    expect(await enforceFunctionsDailyCaps(env)).toBe(0);
    expect(puts).toHaveLength(0);
  });

  it('fails SOFT (returns 0) when the AE query throws — cap just not enforced this cycle', async () => {
    const { env, puts } = kvEnv();
    mockQuery.mockRejectedValue(new Error('AE 403'));
    expect(await enforceFunctionsDailyCaps(env)).toBe(0);
    expect(puts).toHaveLength(0);
  });

  it('returns 0 without querying when creds/KV are absent', async () => {
    const noCreds = { CACHE_KV: {} } as unknown as Env;
    expect(await enforceFunctionsDailyCaps(noCreds)).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('a per-site KV.put failure does not block the other sites (fail-soft per row)', async () => {
    const gets = new Map<string, string>();
    const puts: string[] = [];
    const env = {
      CACHE_KV: {
        get: jest.fn(async (k: string) => gets.get(k) ?? null),
        put: jest.fn(async (k: string) => {
          if (k === 'fn_overcap:bad') throw new Error('kv write fault');
          puts.push(k);
        }),
      },
      CF_ACCOUNT_ID: 'acct',
      CF_API_TOKEN: 'tok',
    } as unknown as Env;
    mockQuery.mockResolvedValue([
      { site_id: 'good1', n: 200000 },
      { site_id: 'bad', n: 200000 },
      { site_id: 'good2', n: 200000 },
    ]);
    const flagged = await enforceFunctionsDailyCaps(env);
    expect(flagged).toBe(2); // good1 + good2; bad threw but didn't abort
    expect(puts).toEqual(['fn_overcap:good1', 'fn_overcap:good2']);
  });
});
