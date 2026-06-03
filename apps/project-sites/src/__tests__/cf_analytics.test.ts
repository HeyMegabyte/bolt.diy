import type { Env } from '../types/env.js';
import {
  classifyUserAgent,
  recordEvent,
  querySql,
  loadOverview,
} from '../services/cf_analytics.js';

const ACCT = '84fa0d1b16ff8086dd958c468ce7fd59';
const TOKEN = 'cf-token-abc';

const writeDataPoint = jest.fn();

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    CF_ACCOUNT_ID: ACCT,
    CF_API_TOKEN: TOKEN,
    ANALYTICS: { writeDataPoint } as unknown,
    ENVIRONMENT: 'test',
    ...overrides,
  } as unknown as Env;
}

const mockFetch = jest.fn();
(global as unknown as { fetch: jest.Mock }).fetch = mockFetch;

function sqlResponse(data: unknown[]): Response {
  return new Response(JSON.stringify({ data, meta: {} }), { status: 200 });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── classifyUserAgent ────────────────────────────────────────

describe('classifyUserAgent', () => {
  it('returns desktop for null/empty UA', () => {
    expect(classifyUserAgent(null)).toBe('desktop');
    expect(classifyUserAgent('')).toBe('desktop');
  });

  it('detects bots/crawlers/spiders/headless', () => {
    expect(classifyUserAgent('Googlebot/2.1')).toBe('bot');
    expect(classifyUserAgent('some crawler here')).toBe('bot');
    expect(classifyUserAgent('a spider')).toBe('bot');
    expect(classifyUserAgent('HeadlessChrome/120')).toBe('bot');
  });

  it('detects tablets (ipad/tablet) before mobile', () => {
    expect(classifyUserAgent('Mozilla/5.0 (iPad; CPU OS 17)')).toBe('tablet');
    expect(classifyUserAgent('Android tablet device')).toBe('tablet');
  });

  it('detects mobile (iphone/android/mobile)', () => {
    expect(classifyUserAgent('iPhone OS 17_0 like Mac OS X')).toBe('mobile');
    expect(classifyUserAgent('Linux; Android 14; Pixel Mobile')).toBe('mobile');
  });

  it('falls back to desktop for ordinary browsers', () => {
    expect(classifyUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/131')).toBe('desktop');
  });
});

// ─── recordEvent ──────────────────────────────────────────────

describe('recordEvent', () => {
  it('is a no-op when ANALYTICS binding is absent', () => {
    recordEvent(makeEnv({ ANALYTICS: undefined }), { event: 'admin_visit' });
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it('writes a fully-populated data point with all fields', () => {
    recordEvent(makeEnv(), {
      event: 'admin_visit',
      routePath: '/admin/forms',
      siteId: 'site-1',
      orgId: 'org-9',
      userAgent: 'iPhone Mobile',
      referrer: 'https://google.com/search?q=x',
      country: 'US',
      latencyMs: 42,
    });
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    const dp = writeDataPoint.mock.calls[0][0];
    expect(dp.blobs).toEqual([
      'admin_visit',
      '/admin/forms',
      'site-1',
      'org-9',
      'mobile',
      'google.com',
      'US',
    ]);
    expect(dp.doubles).toEqual([1, 42]);
    expect(dp.indexes).toEqual(['org-9']);
  });

  it('applies dash/anonymous/zero defaults when optional fields omitted', () => {
    recordEvent(makeEnv(), { event: 'login' });
    const dp = writeDataPoint.mock.calls[0][0];
    expect(dp.blobs).toEqual(['login', '-', '-', '-', 'desktop', '-', '-']);
    expect(dp.doubles).toEqual([1, 0]);
    expect(dp.indexes).toEqual(['anonymous']);
  });

  it('coerces null siteId/orgId/referrer/country to dash', () => {
    recordEvent(makeEnv(), {
      event: 'site_serve',
      siteId: null,
      orgId: null,
      referrer: null,
      country: null,
    });
    const dp = writeDataPoint.mock.calls[0][0];
    expect(dp.blobs[2]).toBe('-');
    expect(dp.blobs[3]).toBe('-');
    expect(dp.blobs[5]).toBe('-');
    expect(dp.blobs[6]).toBe('-');
    expect(dp.indexes).toEqual(['anonymous']);
  });

  it('reduces a malformed referrer to dash (safeHost catch branch)', () => {
    recordEvent(makeEnv(), { event: 'ai_call', referrer: 'not a url' });
    const dp = writeDataPoint.mock.calls[0][0];
    expect(dp.blobs[5]).toBe('-');
  });
});

// ─── querySql ─────────────────────────────────────────────────

describe('querySql', () => {
  it('throws when CF_ACCOUNT_ID is missing', async () => {
    await expect(querySql(makeEnv({ CF_ACCOUNT_ID: undefined }), 'SELECT 1')).rejects.toThrow(
      /CF_ACCOUNT_ID \+ CF_API_TOKEN required/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws when CF_API_TOKEN is missing', async () => {
    await expect(querySql(makeEnv({ CF_API_TOKEN: undefined }), 'SELECT 1')).rejects.toThrow(
      /CF_ACCOUNT_ID \+ CF_API_TOKEN required/,
    );
  });

  it('builds the correct URL, auth header, and text/plain body', async () => {
    mockFetch.mockResolvedValueOnce(sqlResponse([{ visits: 7 }]));
    const rows = await querySql(makeEnv(), 'SELECT 1');
    expect(rows).toEqual([{ visits: 7 }]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCT}/analytics_engine/sql`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.headers['Content-Type']).toBe('text/plain');
    expect(init.body).toBe('SELECT 1');
  });

  it('returns [] when the payload has no data array', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ meta: {} }), { status: 200 }));
    await expect(querySql(makeEnv(), 'SELECT 1')).resolves.toEqual([]);
  });

  it('throws with status + truncated body on non-200', async () => {
    const longBody = 'x'.repeat(600);
    mockFetch.mockResolvedValueOnce(new Response(longBody, { status: 403 }));
    await expect(querySql(makeEnv(), 'SELECT 1')).rejects.toThrow(/Analytics Engine SQL 403:/);
  });

  it('propagates a network throw (no swallow)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('socket reset'));
    await expect(querySql(makeEnv(), 'SELECT 1')).rejects.toThrow('socket reset');
  });
});

// ─── loadOverview ─────────────────────────────────────────────

describe('loadOverview', () => {
  function queueOverviewResponses(): void {
    mockFetch
      .mockResolvedValueOnce(sqlResponse([{ visits: 100 }])) // total
      .mockResolvedValueOnce(sqlResponse([{ day: '2026-06-01', visits: 40 }])) // byDay
      .mockResolvedValueOnce(sqlResponse([{ route_path: '/admin', visits: 30 }])) // byRoute
      .mockResolvedValueOnce(sqlResponse([{ user_agent_class: 'desktop', visits: 90 }])) // byUa
      .mockResolvedValueOnce(sqlResponse([{ referrer: 'google.com', visits: 25 }])) // byRef
      .mockResolvedValueOnce(sqlResponse([{ country: 'US', visits: 60 }])) // byCountry
      .mockResolvedValueOnce(sqlResponse([{ visits: 3 }])); // lastHour
  }

  it('aggregates the seven queries into a typed OverviewSeries', async () => {
    queueOverviewResponses();
    const out = await loadOverview(makeEnv(), 'org-1', 30);
    expect(mockFetch).toHaveBeenCalledTimes(7);
    expect(out.total_visits).toBe(100);
    expect(out.unique_orgs).toBe(0);
    expect(out.visits_by_day).toEqual([{ day: '2026-06-01', visits: 40 }]);
    expect(out.top_routes).toEqual([{ route_path: '/admin', visits: 30 }]);
    expect(out.ua_breakdown).toEqual([{ user_agent_class: 'desktop', visits: 90 }]);
    expect(out.top_referrers).toEqual([{ referrer: 'google.com', visits: 25 }]);
    expect(out.top_countries).toEqual([{ country: 'US', visits: 60 }]);
    expect(out.last_hour_visits).toBe(3);
  });

  it('defaults numeric aggregates to 0 and arrays to [] on empty datasets', async () => {
    for (let i = 0; i < 7; i++) mockFetch.mockResolvedValueOnce(sqlResponse([]));
    const out = await loadOverview(makeEnv(), 'org-1');
    expect(out.total_visits).toBe(0);
    expect(out.last_hour_visits).toBe(0);
    expect(out.visits_by_day).toEqual([]);
    expect(out.top_routes).toEqual([]);
    expect(out.ua_breakdown).toEqual([]);
    expect(out.top_referrers).toEqual([]);
    expect(out.top_countries).toEqual([]);
  });

  it("escapes single quotes in orgId to prevent SQL breakage", async () => {
    queueOverviewResponses();
    await loadOverview(makeEnv(), "o'rg", 30);
    const totalSql = mockFetch.mock.calls[0][1].body as string;
    expect(totalSql).toContain("blob4 = 'o''rg'");
  });

  it('clamps the day window to [1, 365] and applies the lower bound', async () => {
    queueOverviewResponses();
    await loadOverview(makeEnv(), 'org-1', 0);
    const totalSql = mockFetch.mock.calls[0][1].body as string;
    expect(totalSql).toContain("INTERVAL '1' DAY");
  });

  it('clamps an oversized day window to 365', async () => {
    queueOverviewResponses();
    await loadOverview(makeEnv(), 'org-1', 9999);
    const totalSql = mockFetch.mock.calls[0][1].body as string;
    expect(totalSql).toContain("INTERVAL '365' DAY");
  });

  it('always filters on the admin_visit event and the last-hour query uses INTERVAL 1 HOUR', async () => {
    queueOverviewResponses();
    await loadOverview(makeEnv(), 'org-1', 7);
    const totalSql = mockFetch.mock.calls[0][1].body as string;
    const lastHourSql = mockFetch.mock.calls[6][1].body as string;
    expect(totalSql).toContain("blob1 = 'admin_visit'");
    expect(totalSql).toContain("INTERVAL '7' DAY");
    expect(lastHourSql).toContain("INTERVAL '1' HOUR");
    expect(lastHourSql).toContain("blob1 = 'admin_visit'");
  });

  it('propagates a query failure (missing CF creds) out of the Promise.all', async () => {
    await expect(loadOverview(makeEnv({ CF_API_TOKEN: undefined }), 'org-1')).rejects.toThrow(
      /CF_ACCOUNT_ID \+ CF_API_TOKEN required/,
    );
  });
});
