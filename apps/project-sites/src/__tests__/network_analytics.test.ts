import { parseNetworkRange, loadNetworkAnalytics } from '../services/network_analytics';
import type { Env } from '../types/env';

/**
 * Guards the zone-level ("Network Overview") analytics service that powers the
 * always-visible platform-traffic card on the admin Analytics page.
 *  - parseNetworkRange: coerces `?range=` to a known window ('7d' default).
 *  - loadNetworkAnalytics: KV-cache hit, the CF GraphQL success path (real
 *    totals + top countries), and every fail-soft branch (no creds / !ok /
 *    GraphQL errors / fetch throw) — all must degrade to the empty envelope
 *    (`any_real_data: false`), never throw, so the dashboard always renders.
 * `fetch` is mocked; env.CACHE_KV is a stub; worker global-key creds are set so
 * resolveCfCredentials returns a `global` auth without touching D1.
 */
describe('parseNetworkRange', () => {
  it('maps known ranges and defaults the rest to 7d', () => {
    expect(parseNetworkRange('24h')).toBe('24h');
    expect(parseNetworkRange('1d')).toBe('24h'); // legacy alias
    expect(parseNetworkRange('30d')).toBe('30d');
    expect(parseNetworkRange('90d')).toBe('90d');
    expect(parseNetworkRange('7d')).toBe('7d');
    expect(parseNetworkRange('garbage')).toBe('7d');
    expect(parseNetworkRange(null)).toBe('7d');
    expect(parseNetworkRange(undefined)).toBe('7d');
  });
});

describe('loadNetworkAnalytics', () => {
  const originalFetch = global.fetch;

  /** Env with worker global-key creds + a KV stub (get returns `kvGet`). */
  function makeEnv(kvGet: unknown = null) {
    return {
      CACHE_KV: {
        get: jest.fn().mockResolvedValue(kvGet),
        put: jest.fn().mockResolvedValue(undefined),
      },
      CLOUDFLARE_API_KEY: 'k',
      CLOUDFLARE_EMAIL: 'e@x.com',
      CF_ZONE_ID: 'zone-ps',
    } as unknown as Env;
  }

  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the cached envelope without calling the CF API', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const cached = { zone: 'projectsites.dev', total_requests: 42, any_real_data: true };
    const out = await loadNetworkAnalytics(makeEnv(cached), '7d');
    expect(out.total_requests).toBe(42);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aggregates the CF GraphQL zone response into real totals + top countries', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            viewer: {
              zones: [
                {
                  httpRequests1dGroups: [
                    {
                      dimensions: { date: '2026-08-01' },
                      sum: {
                        requests: 100,
                        pageViews: 10,
                        bytes: 500,
                        countryMap: [
                          { clientCountryName: 'US', requests: 90 },
                          { clientCountryName: 'MX', requests: 10 },
                        ],
                      },
                      uniq: { uniques: 7 },
                    },
                    {
                      dimensions: { date: '2026-08-02' },
                      sum: {
                        requests: 200,
                        pageViews: 20,
                        bytes: 800,
                        countryMap: [{ clientCountryName: 'US', requests: 200 }],
                      },
                      uniq: { uniques: 9 },
                    },
                  ],
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;

    const env = makeEnv();
    const out = await loadNetworkAnalytics(env, '7d');
    expect(out.any_real_data).toBe(true);
    expect(out.total_requests).toBe(300);
    expect(out.page_views).toBe(30);
    expect(out.unique_visitors).toBe(16);
    expect(out.bytes).toBe(1300);
    expect(out.series).toHaveLength(2);
    expect(out.top_countries[0]).toEqual({ country: 'US', requests: 290 });
    expect(out.zone).toBe('projectsites.dev');
    expect(env.CACHE_KV.put as jest.Mock).toHaveBeenCalled();
  });

  it('returns the empty envelope when no CF credentials are available', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const env = {
      CACHE_KV: { get: jest.fn().mockResolvedValue(null), put: jest.fn() },
    } as unknown as Env;
    const out = await loadNetworkAnalytics(env, '7d');
    expect(out.any_real_data).toBe(false);
    expect(out.total_requests).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails soft (empty envelope, no throw) on a non-OK CF response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    const out = await loadNetworkAnalytics(makeEnv(), '7d');
    expect(out.any_real_data).toBe(false);
    expect(out.total_requests).toBe(0);
  });

  it('fails soft on a GraphQL errors[] response', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: 'bad field' }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await loadNetworkAnalytics(makeEnv(), '7d');
    expect(out.any_real_data).toBe(false);
  });

  it('fails soft when fetch rejects', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    const out = await loadNetworkAnalytics(makeEnv(), '7d');
    expect(out.any_real_data).toBe(false);
    expect(out.total_requests).toBe(0);
  });
});
