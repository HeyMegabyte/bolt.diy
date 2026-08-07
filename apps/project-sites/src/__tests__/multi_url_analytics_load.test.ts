/**
 * Unit coverage for the analytics DB-loader paths of
 * `services/multi_url_analytics.ts` — `listSiteUrls` (DB read) and the
 * short-circuit branches of `loadMultiUrlAnalytics` (cache-hit, no-credentials
 * fail-soft, exclude-hostname filtering) that resolve BEFORE the per-host
 * GraphQL fan-out. `resolveCfCredentials` is mocked so the no-creds path is
 * deterministic; the full aggregation path (per-host GraphQL) is out of scope.
 *
 * Kept separate from `multi_url_analytics.test.ts` so mocking cf_credentials
 * here does not disturb that file's real-`cfAuthHeaders` resolveZoneForHostname
 * tests.
 */
jest.mock('../services/cf_credentials.js', () => ({
  __esModule: true,
  resolveCfCredentials: jest.fn(),
  cfAuthHeaders: jest.fn(() => ({})),
}));

import { listSiteUrls, loadMultiUrlAnalytics } from '../services/multi_url_analytics.js';
import { resolveCfCredentials } from '../services/cf_credentials.js';
import type { Env } from '../types/env.js';

const mockResolve = resolveCfCredentials as jest.Mock;

const urlRow = (hostname: string, is_primary = 0) => ({
  id: `u-${hostname}`,
  site_id: 's1',
  hostname,
  is_primary,
  zone_id: null,
  account_id: null,
  added_at: 't0',
});

function makeEnv(rows: ReturnType<typeof urlRow>[], kvGet: unknown = null) {
  return {
    DB: {
      prepare: jest.fn(() => ({
        bind: jest.fn(() => ({ all: jest.fn().mockResolvedValue({ results: rows }) })),
      })),
    },
    CACHE_KV: {
      get: jest.fn().mockResolvedValue(kvGet),
      put: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as Env;
}

beforeEach(() => jest.clearAllMocks());

describe('listSiteUrls', () => {
  it('returns the site_urls rows', async () => {
    const rows = [urlRow('a.example.com', 1), urlRow('b.example.com')];
    const out = await listSiteUrls(makeEnv(rows), 's1');
    expect(out).toHaveLength(2);
    expect(out[0].hostname).toBe('a.example.com');
  });
  it('returns [] when the site has no urls', async () => {
    expect(await listSiteUrls(makeEnv([]), 's1')).toEqual([]);
  });
});

describe('loadMultiUrlAnalytics — short-circuit branches', () => {
  it('returns the cached envelope on a cache hit (no CF credential lookup)', async () => {
    const cached = { pageviews: 42, any_real_data: true, urls_included: [] };
    const env = makeEnv([urlRow('a.example.com', 1)], cached);
    const out = await loadMultiUrlAnalytics(env, 's1', 'o1', '7d');
    expect(out.pageviews).toBe(42);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('returns a zeroed, fail-soft envelope when no CF credentials resolve', async () => {
    mockResolve.mockResolvedValue(null);
    const env = makeEnv([urlRow('a.example.com', 1), urlRow('b.example.com')]);
    const out = await loadMultiUrlAnalytics(env, 's1', null, '7d');
    expect(out.any_real_data).toBe(false);
    expect(out.pageviews).toBe(0);
    expect(out.total_requests).toBe(0);
    expect(out.urls_included.map((u) => u.hostname)).toEqual(['a.example.com', 'b.example.com']);
    expect(out.urls_included.every((u) => u.resolved_zone === false)).toBe(true);
  });

  it('excludes hostnames from urls_included per the exclude set', async () => {
    mockResolve.mockResolvedValue(null);
    const env = makeEnv([urlRow('a.example.com', 1), urlRow('b.example.com')]);
    const out = await loadMultiUrlAnalytics(env, 's1', null, '30d', new Set(['b.example.com']));
    expect(out.urls_included.map((u) => u.hostname)).toEqual(['a.example.com']);
    expect(out.range_days).toBe(30);
  });
});

describe('loadMultiUrlAnalytics — creds present but zone resolution fails (fail-soft zeros)', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns zeroed data with any_real_data:false when no host resolves a CF zone', async () => {
    // Credentials DO resolve, but the CF zones API returns no matching zone for
    // either host → resolveZoneForHostname → null → loadHostAggregate zeroes out
    // (GraphQL is never called). Distinct from the no-credentials branch above.
    mockResolve.mockResolvedValue({ kind: 'token', token: 't' });
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }),
      ) as unknown as typeof fetch;
    const env = makeEnv([urlRow('a.example.com', 1), urlRow('b.example.com')]); // kvGet=null → zone cache miss → fetch
    const out = await loadMultiUrlAnalytics(env, 's1', 'o1', '7d');
    expect(out.any_real_data).toBe(false);
    expect(out.pageviews).toBe(0);
    expect(out.total_requests).toBe(0);
    expect(out.series).toEqual([]); // no by-day buckets merged
    expect(out.urls_included.every((u) => u.resolved_zone === false)).toBe(true);
  });
});

describe('loadMultiUrlAnalytics — GraphQL happy-path merge across hosts', () => {
  const originalFetch = global.fetch;
  let dateSpy: { mockRestore(): void } | undefined;
  afterEach(() => {
    global.fetch = originalFetch;
    dateSpy?.mockRestore();
  });

  it('sums per-host aggregates, merges by-day + top-N, and flags any_real_data', async () => {
    // Pin "now" so the per-day alias window date (d0 = today) is deterministic.
    dateSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 5, 1, 12));
    mockResolve.mockResolvedValue({ kind: 'token', token: 't' });
    const zone = { zone_id: 'z1', account_id: 'acc1' };
    // Two hosts sharing apex example.com → both resolve the SAME primed zone.
    const env = {
      DB: {
        prepare: jest.fn(() => ({
          bind: jest.fn(() => ({
            all: jest.fn().mockResolvedValue({
              results: [
                {
                  id: 'u-a',
                  site_id: 's1',
                  hostname: 'a.example.com',
                  is_primary: 1,
                  zone_id: null,
                  account_id: null,
                  added_at: 't0',
                },
                {
                  id: 'u-b',
                  site_id: 's1',
                  hostname: 'b.example.com',
                  is_primary: 0,
                  zone_id: null,
                  account_id: null,
                  added_at: 't1',
                },
              ],
            }),
          })),
        })),
      },
      CACHE_KV: {
        get: jest.fn(async (key: string) => (key.startsWith('zone:') ? zone : null)), // analytics cache miss; zone primed
        put: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as Env;

    // Current CF-GraphQL shape (worker be3b12e0): per-day aliases d0..dN, each
    // `httpRequestsAdaptiveGroups { count sum { visits } }` — count = requests,
    // sum.visits ≈ page views. paths/geo/refs breakdowns carry `{ count dimensions }`.
    // Per-host uniques are NOT exposed by this dataset on the zone plan → 0.
    const gql = {
      data: {
        viewer: {
          zones: [
            {
              d0: [{ count: 120, sum: { visits: 100 } }],
              paths: [{ count: 60, dimensions: { clientRequestPath: '/' } }],
              geo: [{ count: 90, dimensions: { clientCountryName: 'US' } }],
              refs: [{ count: 40, dimensions: { clientRequestReferer: 'https://google.com/' } }],
            },
          ],
        },
      },
    };
    global.fetch = jest
      .fn()
      .mockImplementation(
        () => new Response(JSON.stringify(gql), { status: 200 }),
      ) as unknown as typeof fetch;

    const out = await loadMultiUrlAnalytics(env, 's1', 'o1', '7d');
    expect(out.any_real_data).toBe(true);
    expect(out.pageviews).toBe(200); // 2 hosts × 100
    expect(out.total_requests).toBe(240);
    expect(out.uniques).toBe(0); // per-host uniques not exposed on this zone plan
    expect(out.series).toEqual([
      { date: '2026-06-01', page_views: 200, requests: 240, unique_visitors: 0 },
    ]);
    expect(out.top_pages).toEqual([{ path: '/', views: 120 }]); // merged 60 + 60
    expect(out.top_countries).toEqual([{ country: 'US', views: 180 }]);
    expect(out.urls_included.every((u) => u.resolved_zone)).toBe(true);
  });
});
