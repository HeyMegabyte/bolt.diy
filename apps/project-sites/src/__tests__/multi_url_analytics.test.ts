import { parseRange, apexDomain, resolveZoneForHostname } from '../services/multi_url_analytics';
import type { Env } from '../types/env';
import type { CfAuth } from '../services/cf_credentials';

/**
 * Guards the two pure helpers the admin Analytics surface depends on:
 *  - parseRange: coerces the `?range=` query value to a known range (drives the
 *    CF GraphQL window); anything unknown → '7d' default.
 *  - apexDomain: hostname → registrable apex for CF zone resolution; a wrong
 *    apex resolves the WRONG zone → wrong analytics. Locks www/wildcard strip,
 *    projectsites.dev short-circuit, last-2-labels fallback, and the DOCUMENTED
 *    multi-label-TLD limitation (.co.uk → 'co.uk') so a future fix updates this
 *    test deliberately rather than silently.
 */
describe('parseRange', () => {
  it('maps known ranges', () => {
    expect(parseRange('24h')).toBe('24h');
    expect(parseRange('1d')).toBe('24h'); // legacy alias
    expect(parseRange('30d')).toBe('30d');
    expect(parseRange('90d')).toBe('90d');
    expect(parseRange('7d')).toBe('7d');
  });

  it('defaults unknown / null / undefined to 7d', () => {
    expect(parseRange('garbage')).toBe('7d');
    expect(parseRange('')).toBe('7d');
    expect(parseRange(null)).toBe('7d');
    expect(parseRange(undefined)).toBe('7d');
  });
});

describe('apexDomain', () => {
  it('returns the apex for a plain subdomain (last two labels)', () => {
    expect(apexDomain('shop.example.com')).toBe('example.com');
    expect(apexDomain('a.b.c.example.com')).toBe('example.com');
  });

  it('strips a leading www. and wildcard *.', () => {
    expect(apexDomain('www.example.com')).toBe('example.com');
    expect(apexDomain('*.example.com')).toBe('example.com');
    expect(apexDomain('*.www.example.com')).toBe('example.com');
  });

  it('lowercases the host', () => {
    expect(apexDomain('Shop.EXAMPLE.com')).toBe('example.com');
  });

  it('returns the apex itself when already 2 labels or a single label', () => {
    expect(apexDomain('example.com')).toBe('example.com');
    expect(apexDomain('localhost')).toBe('localhost');
  });

  it('short-circuits projectsites.dev subdomains to the apex', () => {
    expect(apexDomain('mysite.projectsites.dev')).toBe('projectsites.dev');
    expect(apexDomain('a.b.projectsites.dev')).toBe('projectsites.dev');
    expect(apexDomain('projectsites.dev')).toBe('projectsites.dev');
  });

  it('DOCUMENTED LIMITATION: multi-label TLDs resolve to the wrong apex', () => {
    // .co.uk is out of scope (see service JSDoc) — last-two-labels gives 'co.uk'.
    // If this ever gets fixed, update this expectation intentionally.
    expect(apexDomain('shop.example.co.uk')).toBe('co.uk');
  });
});

/**
 * resolveZoneForHostname — maps a hostname to its CF zone (zone_id + account_id),
 * KV-cached 7d. A wrong/missing zone = no analytics, so the branches matter:
 * cache-hit short-circuit, the projectsites.dev hardcoded fast-path, the CF API
 * success/empty/!ok/throw paths (all of which must degrade to null, not throw).
 * `fetch` is mocked; env.CACHE_KV is a stub.
 */
describe('resolveZoneForHostname', () => {
  const AUTH: CfAuth = { kind: 'token', token: 't' };
  const originalFetch = global.fetch;

  function makeEnv(over: Partial<Record<string, unknown>> = {}, kvGet: unknown = null) {
    return {
      CACHE_KV: {
        get: jest.fn().mockResolvedValue(kvGet),
        put: jest.fn().mockResolvedValue(undefined),
      },
      ...over,
    } as unknown as Env;
  }

  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the cached zone without calling the CF API', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const env = makeEnv({}, { zone_id: 'z-cached', account_id: 'a-cached' });
    const out = await resolveZoneForHostname(env, AUTH, 'shop.example.com');
    expect(out).toEqual({ zone_id: 'z-cached', account_id: 'a-cached' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the hardcoded projectsites.dev fast-path (no CF API) and caches it', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const env = makeEnv({ CF_ZONE_ID: 'zone-ps', CF_ACCOUNT_ID: 'acc-ps' });
    const out = await resolveZoneForHostname(env, AUTH, 'mysite.projectsites.dev');
    expect(out).toEqual({ zone_id: 'zone-ps', account_id: 'acc-ps' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(env.CACHE_KV.put as jest.Mock).toHaveBeenCalled();
  });

  it('resolves a zone from a successful CF API response and caches it', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, result: [{ id: 'z1', account: { id: 'a1' } }] }),
        {
          status: 200,
        },
      ),
    ) as unknown as typeof fetch;
    const env = makeEnv();
    const out = await resolveZoneForHostname(env, AUTH, 'example.com');
    expect(out).toEqual({ zone_id: 'z1', account_id: 'a1' });
    expect(env.CACHE_KV.put as jest.Mock).toHaveBeenCalled();
  });

  it('returns null when the CF API returns no matching zone', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, result: [] }), { status: 200 }),
      ) as unknown as typeof fetch;
    expect(await resolveZoneForHostname(makeEnv(), AUTH, 'example.com')).toBeNull();
  });

  it('returns null (not throw) on a non-OK CF API response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('forbidden', { status: 403 })) as unknown as typeof fetch;
    expect(await resolveZoneForHostname(makeEnv(), AUTH, 'example.com')).toBeNull();
  });

  it('returns null (not throw) when fetch rejects', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
    expect(await resolveZoneForHostname(makeEnv(), AUTH, 'example.com')).toBeNull();
  });
});
