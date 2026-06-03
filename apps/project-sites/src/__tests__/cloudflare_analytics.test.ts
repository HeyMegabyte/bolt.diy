import type { Env } from '../types/env.js';
import {
  isCloudflareAnalyticsConfigured,
  loadSiteTraffic,
} from '../services/cloudflare_analytics.js';

const TOKEN = 'cf-token-xyz';
const ZONE = '75a6f8d5e441cd7124552976ba894f83';

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    CF_API_TOKEN: TOKEN,
    CF_ZONE_ID: ZONE,
    ENVIRONMENT: 'test',
    ...overrides,
  } as unknown as Env;
}

const mockFetch = jest.fn();
(global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

/** Build a CF GraphQL 200 response wrapping `data`. */
function gqlResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

/** A fully-populated single-zone payload. */
function fullZonePayload() {
  return {
    data: {
      viewer: {
        zones: [
          {
            totals: [
              {
                sum: { requests: 1000, pageViews: 620, edgeResponseBytes: 50_000 },
                uniq: { uniques: 240 },
              },
            ],
            byDay: [
              {
                dimensions: { date: '2026-05-30' },
                sum: { requests: 400, pageViews: 250, edgeResponseBytes: 20_000 },
                uniq: { uniques: 90 },
              },
              {
                dimensions: { date: '2026-05-31' },
                sum: { requests: 600, pageViews: 370, edgeResponseBytes: 30_000 },
                uniq: { uniques: 150 },
              },
            ],
            topPaths: [
              { dimensions: { clientRequestPath: '/' }, sum: { requests: 700 } },
              { dimensions: { clientRequestPath: '/about' }, sum: { requests: 300 } },
            ],
            byCountry: [
              { dimensions: { clientCountryName: 'United States' }, sum: { requests: 800 } },
              { dimensions: { clientCountryName: 'Canada' }, sum: { requests: 200 } },
            ],
          },
        ],
      },
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── isCloudflareAnalyticsConfigured ──────────────────────────

describe('isCloudflareAnalyticsConfigured', () => {
  it('is true when both token and zone id are present', () => {
    expect(isCloudflareAnalyticsConfigured(makeEnv())).toBe(true);
  });

  it('is false when the token is missing', () => {
    expect(isCloudflareAnalyticsConfigured(makeEnv({ CF_API_TOKEN: undefined }))).toBe(false);
  });

  it('is false when the zone id is missing', () => {
    expect(isCloudflareAnalyticsConfigured(makeEnv({ CF_ZONE_ID: undefined }))).toBe(false);
  });

  it('is false when both are missing', () => {
    expect(
      isCloudflareAnalyticsConfigured(makeEnv({ CF_API_TOKEN: undefined, CF_ZONE_ID: undefined })),
    ).toBe(false);
  });

  it('coerces empty strings to a false (not "")', () => {
    expect(isCloudflareAnalyticsConfigured(makeEnv({ CF_API_TOKEN: '' }))).toBe(false);
  });
});

// ─── loadSiteTraffic: config guard ────────────────────────────

describe('loadSiteTraffic — config guard', () => {
  it('throws when not configured and never calls fetch', async () => {
    await expect(
      loadSiteTraffic(makeEnv({ CF_API_TOKEN: undefined }), 'vitos-mens-salon', 7),
    ).rejects.toThrow(/CF_API_TOKEN \+ CF_ZONE_ID required/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── loadSiteTraffic: request build + auth ────────────────────

describe('loadSiteTraffic — request build + auth', () => {
  it('POSTs to the CF GraphQL endpoint with bearer auth + JSON content type', async () => {
    mockFetch.mockResolvedValueOnce(gqlResponse(fullZonePayload()));
    await loadSiteTraffic(makeEnv(), 'vitos-mens-salon', 7);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.cloudflare.com/client/v4/graphql');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends the slug as a {slug}.projectsites.dev host filter + zoneTag variable', async () => {
    mockFetch.mockResolvedValueOnce(gqlResponse(fullZonePayload()));
    await loadSiteTraffic(makeEnv(), 'vitos-mens-salon', 7);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.variables.host).toBe('vitos-mens-salon.projectsites.dev');
    expect(body.variables.zoneTag).toBe(ZONE);
    expect(typeof body.variables.since).toBe('string');
    expect(typeof body.variables.until).toBe('string');
    expect(body.query).toContain('httpRequestsAdaptiveGroups');
  });

  it('defaults the window to 7 days when days arg is omitted', async () => {
    mockFetch.mockResolvedValueOnce(gqlResponse(fullZonePayload()));
    const out = await loadSiteTraffic(makeEnv(), 'vitos-mens-salon');
    expect(out.range_days).toBe(7);
  });
});

// ─── loadSiteTraffic: time-range clamping ─────────────────────

describe('loadSiteTraffic — time-range clamping', () => {
  async function rangeFor(days: number): Promise<number> {
    mockFetch.mockResolvedValueOnce(gqlResponse(fullZonePayload()));
    const out = await loadSiteTraffic(makeEnv(), 'site', days);
    return out.range_days;
  }

  it('clamps a too-small window up to 1', async () => {
    expect(await rangeFor(0)).toBe(1);
  });

  it('clamps a negative window up to 1', async () => {
    expect(await rangeFor(-99)).toBe(1);
  });

  it('clamps an oversized window down to 30', async () => {
    expect(await rangeFor(9999)).toBe(30);
  });

  it('floors a fractional window', async () => {
    expect(await rangeFor(7.9)).toBe(7);
  });

  it('keeps an in-range window unchanged', async () => {
    expect(await rangeFor(14)).toBe(14);
  });

  it('computes since earlier than until by the clamped range', async () => {
    mockFetch.mockResolvedValueOnce(gqlResponse(fullZonePayload()));
    await loadSiteTraffic(makeEnv(), 'site', 7);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(new Date(body.variables.since).getTime()).toBeLessThan(
      new Date(body.variables.until).getTime(),
    );
  });
});

// ─── loadSiteTraffic: success parse + aggregation ─────────────

describe('loadSiteTraffic — success parse + aggregation', () => {
  it('aggregates totals, daily series, top paths, and countries', async () => {
    mockFetch.mockResolvedValueOnce(gqlResponse(fullZonePayload()));
    const out = await loadSiteTraffic(makeEnv(), 'vitos-mens-salon', 7);

    expect(out.total_requests).toBe(1000);
    expect(out.page_views).toBe(620);
    expect(out.unique_visitors).toBe(240);

    expect(out.by_day).toEqual([
      { day: '2026-05-30', requests: 400, page_views: 250, unique_visitors: 90, bytes: 20_000 },
      { day: '2026-05-31', requests: 600, page_views: 370, unique_visitors: 150, bytes: 30_000 },
    ]);

    expect(out.top_paths).toEqual([
      { path: '/', requests: 700 },
      { path: '/about', requests: 300 },
    ]);

    expect(out.by_country).toEqual([
      { country: 'United States', requests: 800 },
      { country: 'Canada', requests: 200 },
    ]);
  });

  it('coerces missing numeric/string fields to 0/default within rows', async () => {
    const payload = {
      data: {
        viewer: {
          zones: [
            {
              // totals row present but sum/uniq absent
              totals: [{}],
              byDay: [{ dimensions: {}, sum: {}, uniq: {} }],
              topPaths: [{ dimensions: {}, sum: {} }],
              byCountry: [{ dimensions: {}, sum: {} }],
            },
          ],
        },
      },
    };
    mockFetch.mockResolvedValueOnce(gqlResponse(payload));
    const out = await loadSiteTraffic(makeEnv(), 'site', 7);

    expect(out.total_requests).toBe(0);
    expect(out.page_views).toBe(0);
    expect(out.unique_visitors).toBe(0);
    expect(out.by_day).toEqual([{ day: '', requests: 0, page_views: 0, unique_visitors: 0, bytes: 0 }]);
    expect(out.top_paths).toEqual([{ path: '/', requests: 0 }]);
    expect(out.by_country).toEqual([{ country: 'Unknown', requests: 0 }]);
  });

  it('handles a zone with no group arrays (undefined → [] / 0)', async () => {
    const payload = { data: { viewer: { zones: [{}] } } };
    mockFetch.mockResolvedValueOnce(gqlResponse(payload));
    const out = await loadSiteTraffic(makeEnv(), 'site', 7);

    expect(out.total_requests).toBe(0);
    expect(out.page_views).toBe(0);
    expect(out.unique_visitors).toBe(0);
    expect(out.by_day).toEqual([]);
    expect(out.top_paths).toEqual([]);
    expect(out.by_country).toEqual([]);
  });
});

// ─── loadSiteTraffic: empty dataset ───────────────────────────

describe('loadSiteTraffic — empty dataset', () => {
  it('returns an empty envelope when the zones array is empty', async () => {
    mockFetch.mockResolvedValueOnce(gqlResponse({ data: { viewer: { zones: [] } } }));
    const out = await loadSiteTraffic(makeEnv(), 'site', 14);
    expect(out).toEqual({
      range_days: 14,
      total_requests: 0,
      page_views: 0,
      unique_visitors: 0,
      by_day: [],
      top_paths: [],
      by_country: [],
    });
  });

  it('returns an empty envelope when viewer/zones is missing entirely', async () => {
    mockFetch.mockResolvedValueOnce(gqlResponse({ data: {} }));
    const out = await loadSiteTraffic(makeEnv(), 'site', 3);
    expect(out.range_days).toBe(3);
    expect(out.total_requests).toBe(0);
    expect(out.by_day).toEqual([]);
  });

  it('returns an empty envelope when the whole data field is absent', async () => {
    mockFetch.mockResolvedValueOnce(gqlResponse({}));
    const out = await loadSiteTraffic(makeEnv(), 'site', 1);
    expect(out.total_requests).toBe(0);
    expect(out.top_paths).toEqual([]);
  });
});

// ─── loadSiteTraffic: error / resilience ──────────────────────

describe('loadSiteTraffic — error handling', () => {
  it('throws with status + truncated body on a non-200 response', async () => {
    const longBody = 'y'.repeat(800);
    mockFetch.mockResolvedValueOnce(new Response(longBody, { status: 500 }));
    await expect(loadSiteTraffic(makeEnv(), 'site', 7)).rejects.toThrow(/CF GraphQL 500:/);
  });

  it('throws on a 4xx response as well', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    await expect(loadSiteTraffic(makeEnv(), 'site', 7)).rejects.toThrow(/CF GraphQL 403:/);
  });

  it('throws joining all GraphQL errors[] messages', async () => {
    mockFetch.mockResolvedValueOnce(
      gqlResponse({ errors: [{ message: 'bad zone' }, { message: 'no perms' }] }),
    );
    await expect(loadSiteTraffic(makeEnv(), 'site', 7)).rejects.toThrow(
      /CF GraphQL errors: bad zone; no perms/,
    );
  });

  it('ignores an empty errors[] array and proceeds to parse data', async () => {
    mockFetch.mockResolvedValueOnce(
      gqlResponse({ errors: [], ...fullZonePayload() }),
    );
    const out = await loadSiteTraffic(makeEnv(), 'site', 7);
    expect(out.total_requests).toBe(1000);
  });

  it('propagates a network throw without swallowing it', async () => {
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(loadSiteTraffic(makeEnv(), 'site', 7)).rejects.toThrow('socket hang up');
  });
});
