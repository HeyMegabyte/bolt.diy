/**
 * Unit tests for the Cloudflare Registrar API client
 * ({@link services/cf_registrar.ts}).
 *
 * Covers every branch:
 *   - pure helpers: buildTldPriceMap, porkbunFallback, staticTldPriceUsd,
 *     isKnownUnsupportedTld
 *   - checkDomains: empty input, auth-missing fallback, success parse
 *     (price rounding, registrable/cf_carries inference, omitted rows),
 *     non-200 / success:false fallback, network-throw fallback, Bearer vs
 *     global-key auth headers, 20-domain cap + lowercase/trim normalization
 *   - registerDomain: invalid FQDN, known-unsupported TLD short-circuit,
 *     auth-missing, success (201 sync + 202 async poll url), legacy +
 *     canonical contact normalization, request payload + auth header shape,
 *     CF unsupported-TLD error mapping, generic CF_API_ERROR, network throw
 *
 * Mocks the Cloudflare Registrar REST calls via `global.fetch` — never hits
 * the real API.
 */

import type { Env } from '../types/env.js';
import {
  buildTldPriceMap,
  porkbunFallback,
  staticTldPriceUsd,
  isKnownUnsupportedTld,
  checkDomains,
  registerDomain,
  type RegisterContact,
} from '../services/cf_registrar.js';

const ACCOUNT_ID = 'acct-123';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
  // Silence the structured console.warn fallback logs.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const bearerEnv = (overrides: Partial<Env> = {}): Env =>
  ({ CF_API_TOKEN: 'cf-token-abc', ...overrides }) as unknown as Env;

const globalKeyEnv = (): Env =>
  ({
    CLOUDFLARE_API_KEY: 'global-key-xyz',
    CLOUDFLARE_EMAIL: 'ops@projectsites.dev',
  }) as unknown as Env;

const noAuthEnv = (): Env => ({}) as unknown as Env;

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  });
}

const baseContact: RegisterContact = {
  name: 'Acme Inc',
  email: 'owner@acme.test',
  phone: '+15551234567',
  city: 'Newark',
  state: 'NJ',
  street: '123 Main St',
  postal_code: '07102',
  country_code: 'us',
};

// ─── Pure helpers ────────────────────────────────────────────

describe('staticTldPriceUsd', () => {
  it('returns the static price for a known TLD (case-insensitive)', () => {
    expect(staticTldPriceUsd('com')).toBe(10);
    expect(staticTldPriceUsd('IO')).toBe(35);
  });

  it('returns null for an unknown TLD', () => {
    expect(staticTldPriceUsd('zzz')).toBeNull();
  });
});

describe('isKnownUnsupportedTld', () => {
  it('returns true for a TLD CF does not carry (case-insensitive)', () => {
    expect(isKnownUnsupportedTld('xyz')).toBe(true);
    expect(isKnownUnsupportedTld('SHOP')).toBe(true);
  });

  it('returns false for a carried TLD', () => {
    expect(isKnownUnsupportedTld('com')).toBe(false);
  });
});

describe('porkbunFallback', () => {
  it('builds an encoded Porkbun checkout deeplink', () => {
    expect(porkbunFallback('my site.com')).toBe(
      'https://porkbun.com/checkout/search?q=my%20site.com',
    );
  });
});

describe('buildTldPriceMap', () => {
  it('returns a row per static TLD with can_register reflecting unsupported set', async () => {
    const map = await buildTldPriceMap(noAuthEnv());
    expect(map.get('com')).toEqual({
      tld: 'com',
      supported: true,
      registration_price_usd_yr: 10,
      renewal_price_usd_yr: 10,
      can_register: true,
      can_transfer: true,
    });
    // 'xyz' is not in the static price table, so it is absent from the map.
    expect(map.has('xyz')).toBe(false);
    // Every entry in the static table is present.
    expect(map.size).toBeGreaterThanOrEqual(12);
  });
});

// ─── checkDomains ────────────────────────────────────────────

describe('checkDomains', () => {
  it('returns [] for empty input without calling fetch', async () => {
    const out = await checkDomains(bearerEnv(), [], ACCOUNT_ID);
    expect(out).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to static pricing when no CF auth is present', async () => {
    const out = await checkDomains(noAuthEnv(), ['Acme.COM', ' shop.shop '], ACCOUNT_ID);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(out).toEqual([
      { name: 'acme.com', registrable: false, price_usd_yr: 10, cf_carries: true },
      // .shop is a known-unsupported TLD → cf_carries false, no static price
      { name: 'shop.shop', registrable: false, price_usd_yr: null, cf_carries: false },
    ]);
  });

  it('parses a successful domain-check, rounding price + inferring cf_carries', async () => {
    mockFetchOnce({
      success: true,
      result: {
        domains: [
          {
            name: 'acme.com',
            registrable: true,
            tier: 'standard',
            pricing: { currency: 'USD', registration_cost: '10.49' },
          },
          {
            name: 'acme.io',
            registrable: false,
            reason: 'unavailable',
            pricing: { registration_cost: 35 },
          },
        ],
      },
    });

    const out = await checkDomains(bearerEnv(), ['acme.com', 'acme.io'], ACCOUNT_ID);
    expect(out[0]).toEqual({
      name: 'acme.com',
      registrable: true,
      price_usd_yr: 10, // Math.round(10.49)
      cf_carries: true,
      tier: 'standard',
      reason: undefined,
    });
    expect(out[1]).toEqual({
      name: 'acme.io',
      registrable: false,
      price_usd_yr: 35,
      // registrable false but reason !== 'tld_not_supported' → cf_carries true
      cf_carries: true,
      tier: undefined,
      reason: 'unavailable',
    });
  });

  it('marks cf_carries false when CF reason is tld_not_supported and price null when absent', async () => {
    mockFetchOnce({
      success: true,
      result: {
        domains: [{ name: 'acme.com', registrable: false, reason: 'tld_not_supported' }],
      },
    });
    const [row] = await checkDomains(bearerEnv(), ['acme.com'], ACCOUNT_ID);
    expect(row.cf_carries).toBe(false);
    expect(row.price_usd_yr).toBeNull();
  });

  it('fills missing rows from the static fallback when CF omits a domain', async () => {
    mockFetchOnce({
      success: true,
      result: { domains: [{ name: 'acme.com', registrable: true }] },
    });
    const out = await checkDomains(bearerEnv(), ['acme.com', 'acme.dev'], ACCOUNT_ID);
    expect(out[0].name).toBe('acme.com');
    // acme.dev was omitted by CF → fallbackCheckResult (.dev static price 13)
    expect(out[1]).toEqual({
      name: 'acme.dev',
      registrable: false,
      price_usd_yr: 13,
      cf_carries: true,
    });
  });

  it('ignores result rows with no name', async () => {
    mockFetchOnce({
      success: true,
      result: { domains: [{ registrable: true }, { name: '', registrable: true }] },
    });
    const out = await checkDomains(bearerEnv(), ['acme.com'], ACCOUNT_ID);
    // Nothing matched → falls back for the single requested domain.
    expect(out[0]).toEqual({
      name: 'acme.com',
      registrable: false,
      price_usd_yr: 10,
      cf_carries: true,
    });
  });

  it('falls back to static pricing on a non-200 response', async () => {
    mockFetchOnce({ errors: [{ message: 'boom' }] }, { ok: false, status: 500 });
    const out = await checkDomains(bearerEnv(), ['acme.com'], ACCOUNT_ID);
    expect(out[0].price_usd_yr).toBe(10);
    expect(out[0].registrable).toBe(false);
  });

  it('falls back to static pricing when success:false', async () => {
    mockFetchOnce({ success: false, errors: [{ message: 'nope' }] });
    const out = await checkDomains(bearerEnv(), ['acme.com'], ACCOUNT_ID);
    expect(out[0].cf_carries).toBe(true);
  });

  it('falls back to static pricing when fetch throws (network failure)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('ECONNRESET'));
    const out = await checkDomains(bearerEnv(), ['acme.com'], ACCOUNT_ID);
    expect(out[0].price_usd_yr).toBe(10);
  });

  it('handles a non-JSON response body gracefully (json throws)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });
    const out = await checkDomains(bearerEnv(), ['acme.com'], ACCOUNT_ID);
    // .catch(() => ({})) → empty body → no result.domains → fallback per input
    expect(out[0].name).toBe('acme.com');
    expect(out[0].price_usd_yr).toBe(10);
  });

  it('sends Bearer auth + JSON body of lowercased/trimmed domains', async () => {
    mockFetchOnce({ success: true, result: { domains: [] } });
    await checkDomains(bearerEnv(), ['  Acme.COM ', 'Foo.NET'], ACCOUNT_ID);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain(`/accounts/${ACCOUNT_ID}/registrar/domain-check`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer cf-token-abc');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ domains: ['acme.com', 'foo.net'] });
  });

  it('uses global-key auth headers when CF_API_TOKEN is absent', async () => {
    mockFetchOnce({ success: true, result: { domains: [] } });
    await checkDomains(globalKeyEnv(), ['acme.com'], ACCOUNT_ID);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-Auth-Email']).toBe('ops@projectsites.dev');
    expect(init.headers['X-Auth-Key']).toBe('global-key-xyz');
    expect(init.headers.Authorization).toBeUndefined();
  });

  it('caps the request at 20 domains', async () => {
    mockFetchOnce({ success: true, result: { domains: [] } });
    const many = Array.from({ length: 25 }, (_, i) => `d${i}.com`);
    await checkDomains(bearerEnv(), many, ACCOUNT_ID);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body).domains).toHaveLength(20);
  });
});

// ─── registerDomain ──────────────────────────────────────────

describe('registerDomain', () => {
  it('rejects an invalid (non-FQDN) domain without calling fetch', async () => {
    const res = await registerDomain(bearerEnv(), {
      domain: 'notadomain',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    expect(res).toMatchObject({ ok: false, error: 'INVALID_DOMAIN', domain: 'notadomain' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('short-circuits to TLD_NOT_SUPPORTED + Porkbun fallback for unsupported TLDs', async () => {
    const res = await registerDomain(bearerEnv(), {
      domain: 'Acme.SHOP',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('TLD_NOT_SUPPORTED');
    expect(res.fallback_url).toBe('https://porkbun.com/checkout/search?q=acme.shop');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns CF_AUTH_MISSING when no auth is configured', async () => {
    const res = await registerDomain(noAuthEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    expect(res).toMatchObject({ ok: false, error: 'CF_AUTH_MISSING', domain: 'acme.com' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('registers successfully and returns poll_url + transaction_id (async 202)', async () => {
    mockFetchOnce(
      {
        success: true,
        result: {
          state: 'in_progress',
          links: { self: '/accounts/acct-123/registrar/registrations/reg-789' },
        },
      },
      { ok: true, status: 202 },
    );
    const res = await registerDomain(bearerEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: baseContact,
      years: 2,
    });
    expect(res.ok).toBe(true);
    expect(res.poll_url).toBe('/accounts/acct-123/registrar/registrations/reg-789');
    expect(res.transaction_id).toBe('reg-789');
    expect(res.state).toBe('in_progress');
  });

  it('defaults state to pending and transaction_id undefined when no poll url (sync 201)', async () => {
    mockFetchOnce({ success: true, result: {} }, { ok: true, status: 201 });
    const res = await registerDomain(bearerEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    expect(res.ok).toBe(true);
    expect(res.state).toBe('pending');
    expect(res.transaction_id).toBeUndefined();
    expect(res.poll_url).toBeUndefined();
  });

  it('sends the correct payload shape + auth header (canonical contact fields)', async () => {
    mockFetchOnce({ success: true, result: { state: 'pending' } }, { ok: true, status: 201 });
    await registerDomain(bearerEnv(), {
      domain: 'Acme.COM',
      account_id: ACCOUNT_ID,
      contact: { ...baseContact, organization: 'Acme LLC' },
      years: 3,
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain(`/accounts/${ACCOUNT_ID}/registrar/registrations`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer cf-token-abc');
    const payload = JSON.parse(init.body);
    expect(payload.domain_name).toBe('acme.com');
    expect(payload.privacy_mode).toBe('redaction');
    expect(payload.auto_renew).toBe(true);
    expect(payload.years).toBe(3);
    const reg = payload.contacts.registrant;
    expect(reg.email).toBe('owner@acme.test');
    expect(reg.postal_info.name).toBe('Acme Inc');
    expect(reg.postal_info.organization).toBe('Acme LLC');
    expect(reg.postal_info.address).toMatchObject({
      street: '123 Main St',
      city: 'Newark',
      state: 'NJ',
      postal_code: '07102',
      country_code: 'US', // uppercased + truncated to 2 chars
    });
  });

  it('normalizes legacy contact fields (first/last name, address, zip, country)', async () => {
    mockFetchOnce({ success: true, result: { state: 'pending' } }, { ok: true, status: 201 });
    await registerDomain(bearerEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: {
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@acme.test',
        phone: '+15550000000',
        city: 'Newark',
        state: 'NJ',
        address: '99 Legacy Ave',
        zip: '07103',
        country: 'usa',
      },
    });
    const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    const addr = payload.contacts.registrant.postal_info;
    expect(addr.name).toBe('Jane Doe');
    expect(addr.address.street).toBe('99 Legacy Ave');
    expect(addr.address.postal_code).toBe('07103');
    expect(addr.address.country_code).toBe('US');
  });

  it('defaults the registrant name to "Site Owner" when none provided', async () => {
    mockFetchOnce({ success: true, result: { state: 'pending' } }, { ok: true, status: 201 });
    await registerDomain(bearerEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: { email: 'x@acme.test', phone: '+15550000000', city: 'Newark', state: 'NJ' },
    });
    const payload = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(payload.contacts.registrant.postal_info.name).toBe('Site Owner');
    // No street/postal/country provided → defaults applied.
    expect(payload.contacts.registrant.postal_info.address.country_code).toBe('US');
  });

  it('maps a CF unsupported-TLD error message to TLD_NOT_SUPPORTED + Porkbun fallback', async () => {
    mockFetchOnce(
      { success: false, errors: [{ code: 1004, message: 'TLD not supported by registrar' }] },
      { ok: false, status: 400 },
    );
    const res = await registerDomain(bearerEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('TLD_NOT_SUPPORTED');
    expect(res.fallback_url).toBe('https://porkbun.com/checkout/search?q=acme.com');
  });

  it('returns CF_API_ERROR for a generic CF failure', async () => {
    mockFetchOnce(
      { success: false, errors: [{ code: 9000, message: 'account suspended' }] },
      { ok: false, status: 403 },
    );
    const res = await registerDomain(bearerEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('CF_API_ERROR');
    expect(res.message).toContain('account suspended');
    expect(res.cf_body).toBeDefined();
  });

  it('falls back to result.error.message then HTTP status when errors[] absent', async () => {
    mockFetchOnce({ success: false, result: {} }, { ok: false, status: 502 });
    const res = await registerDomain(bearerEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    expect(res.error).toBe('CF_API_ERROR');
    expect(res.message).toContain('HTTP 502');
  });

  it('returns CF_API_ERROR when the fetch call throws (network failure)', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('socket hang up'));
    const res = await registerDomain(bearerEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('CF_API_ERROR');
    expect(res.message).toContain('socket hang up');
  });

  it('uses global-key headers for registration when CF_API_TOKEN is absent', async () => {
    mockFetchOnce({ success: true, result: { state: 'pending' } }, { ok: true, status: 201 });
    await registerDomain(globalKeyEnv(), {
      domain: 'acme.com',
      account_id: ACCOUNT_ID,
      contact: baseContact,
    });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['X-Auth-Email']).toBe('ops@projectsites.dev');
    expect(init.headers['X-Auth-Key']).toBe('global-key-xyz');
  });
});
