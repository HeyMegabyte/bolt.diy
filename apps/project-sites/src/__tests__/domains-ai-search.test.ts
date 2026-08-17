/**
 * @module __tests__/domains-ai-search
 * @description Unit tests for the AI-powered creative domain search route.
 *
 * Verifies that:
 *  1. Workers AI fan-out aggregates candidates across multiple strategies.
 *  2. Duplicate candidates from different strategies are deduped.
 *  3. RDAP availability (via `checkBatch`) merges availability + pricing
 *     correctly and slots each candidate into `available` vs `unavailable`.
 *     (The CF Registrar `/registrar/domains/check` endpoint 404s and is NOT a
 *     public API — `checkDomainAvailability` routes through RDAP instead.)
 *  4. When availability enrichment returns all-unknown OR throws, the search
 *     still 200s with every AI candidate surfaced (availability is secondary).
 *
 * @packageDocumentation
 */

// ─── Module Mocks (must be before imports) ───────────────────

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
  getAuditLogs: jest.fn().mockResolvedValue({ data: [] }),
  getSiteAuditLogs: jest.fn().mockResolvedValue({ data: [] }),
}));

jest.mock('../lib/posthog.js', () => ({
  capture: jest.fn(),
  trackAuth: jest.fn(),
  trackSite: jest.fn(),
  trackError: jest.fn(),
  trackDomain: jest.fn(),
  trackBilling: jest.fn(),
}));

// Availability is proven by RDAP (checkDomainAvailability now routes through
// checkBatch — the CF Registrar /check endpoint 404s). Mock it per-domain.
jest.mock('../services/rdap_availability.js', () => ({
  checkBatch: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { dbQueryOne } from '../services/db.js';
import { checkBatch } from '../services/rdap_availability.js';

const mockDbQueryOne = dbQueryOne as jest.Mock;
const mockCheckBatch = checkBatch as jest.Mock;
/** Build an RdapResult row for a domain. */
const rdap = (domain: string, status: 'available' | 'taken' | 'unknown') => ({
  domain,
  available: status === 'available',
  status,
  source: status === 'unknown' ? 'rdap-error' : 'rdap',
});

const TEST_SITE_ID = 'site-ai-1';
const TEST_ORG_ID = 'org-ai-1';

function createMockEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    CACHE_KV: {
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    SITES_BUCKET: {
      list: jest.fn().mockResolvedValue({ objects: [] }),
      get: jest.fn().mockResolvedValue(null),
      put: jest.fn().mockResolvedValue(undefined),
    },
    POSTHOG_API_KEY: 'phc_test',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_PUBLISHABLE_KEY: 'pk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    GOOGLE_CLIENT_ID: 'gid',
    GOOGLE_CLIENT_SECRET: 'gsec',
    GOOGLE_PLACES_API_KEY: 'gpk',
    CF_API_TOKEN: 'cf-test-token',
    CF_ZONE_ID: 'zone-1',
    CF_ACCOUNT_ID: 'acct-1',
    AI: {
      run: jest.fn(),
    } as unknown as Ai,
  } as unknown as Env;
}

function createAuthenticatedApp() {
  const authedApp = new Hono<{ Bindings: Env; Variables: Variables }>();
  authedApp.onError(errorHandler);
  authedApp.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    c.set('orgId', TEST_ORG_ID);
    c.set('requestId', 'req-1');
    await next();
  });
  authedApp.route('/', api);
  return { app: authedApp, env: createMockEnv() };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Default fetch stub so NO test (incl. the no-explicit-mock 401/404 cases and
  // any availability check that runs after the response) can hit the REAL
  // network — a real outbound RDAP/Registrar fetch leaves an undici keepalive
  // socket that force-exits the worker ("worker failed to exit gracefully",
  // scheduling-flaky suite FAIL). The two tests below override this with their
  // own richer mock.
  globalThis.fetch = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ available_domains: [], status: 200 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('POST /api/sites/:siteId/domains/ai-search', () => {
  it('returns 401 without auth', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.onError(errorHandler);
    app.route('/', api);
    const res = await app.request(
      `/api/sites/${TEST_SITE_ID}/domains/ai-search`,
      { method: 'POST', body: JSON.stringify({ query: 'salon' }) },
      createMockEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the site belongs to another org', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);
    const { app, env } = createAuthenticatedApp();
    const res = await app.request(
      `/api/sites/${TEST_SITE_ID}/domains/ai-search`,
      { method: 'POST', body: JSON.stringify({ query: 'salon' }) },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('aggregates candidates across strategies, dedupes, and tags availability', async () => {
    // 1st query lookups the site, 2nd lookups ai_site_settings.
    mockDbQueryOne
      .mockResolvedValueOnce({
        id: TEST_SITE_ID,
        business_name: "Vito's Mens Salon",
        business_address: '74 N Beverwyck Rd, Lake Hiawatha, NJ',
      })
      .mockResolvedValueOnce({ chat_system_prompt: 'Sharp. Punchy. Old-school barbershop voice.' });

    const { app, env } = createAuthenticatedApp();

    // Two strategies return overlapping suggestions to exercise the dedupe.
    const aiRun = env.AI.run as jest.Mock;
    aiRun.mockImplementation((_model: string, opts: { messages: Array<{ content: string }> }) => {
      const sys = opts.messages[0]?.content ?? '';
      if (sys.includes('literal')) {
        return Promise.resolve({ response: '- vitossalon.com\n- mensbarber.com\n' });
      }
      if (sys.includes('metaphor')) {
        return Promise.resolve({ response: 'ironpaw.com\nblademaster.dev\n' });
      }
      if (sys.includes('compound')) {
        // Includes a duplicate of "vitossalon.com" to verify dedupe.
        return Promise.resolve({ response: 'vitossalon.com, sharpfade.io' });
      }
      return Promise.resolve({ response: '' });
    });

    // Mock the RDAP availability batch (the real availability provider).
    mockCheckBatch.mockResolvedValue([
      rdap('vitossalon.com', 'taken'),
      rdap('mensbarber.com', 'available'),
      rdap('ironpaw.com', 'available'),
      rdap('blademaster.dev', 'available'),
      rdap('sharpfade.io', 'taken'),
    ]);

    const res = await app.request(
      `/api/sites/${TEST_SITE_ID}/domains/ai-search`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'premium barber shop' }),
      },
      env,
    );
    expect(res.status).toBe(200);

    // SCHEMA-DRIFT GUARD: the site-ownership lookup must select ONLY real `sites`
    // columns. `business_type` does NOT exist — selecting it threw `no such column`,
    // which dbQueryOne swallows → null → requireOwnedSite 404'd EVERY site (owned or
    // not), making ai-search 100% broken in prod. This mock returns a row regardless
    // of columns, so it can't catch a bad column at runtime — assert the SQL instead.
    const siteLookupSql = String(mockDbQueryOne.mock.calls[0]?.[1] ?? '');
    expect(siteLookupSql).toMatch(/FROM sites/i);
    expect(siteLookupSql).not.toMatch(/business_type/);
    expect(siteLookupSql).toContain('business_name');
    expect(siteLookupSql).toContain('business_address');

    const body = (await res.json()) as {
      data: {
        available: Array<{ name: string; strategy: string; price_usd: number }>;
        unavailable: Array<{ name: string; strategy: string }>;
      };
    };

    const allNames = [
      ...body.data.available.map((c) => c.name),
      ...body.data.unavailable.map((c) => c.name),
    ];
    // Dedupe: vitossalon.com appears in literal AND compound but must appear once.
    expect(allNames.filter((n) => n === 'vitossalon.com').length).toBe(1);

    // Availability merge: mensbarber.com landed in `available`, vitossalon in `unavailable`.
    expect(body.data.available.find((c) => c.name === 'mensbarber.com')).toBeTruthy();
    expect(body.data.unavailable.find((c) => c.name === 'vitossalon.com')).toBeTruthy();

    // Strategy badges propagate to the response.
    const ironpaw = body.data.available.find((c) => c.name === 'ironpaw.com');
    expect(ironpaw?.strategy).toBe('metaphor');
    const sharpfade = body.data.unavailable.find((c) => c.name === 'sharpfade.io');
    expect(sharpfade?.strategy).toBe('compound');

    // RDAP availability was checked exactly once with the deduped candidate list.
    expect(mockCheckBatch).toHaveBeenCalledTimes(1);
    const checkedNames = mockCheckBatch.mock.calls[0]?.[1] as string[];
    expect(checkedNames).toContain('vitossalon.com');
    expect(checkedNames).toContain('sharpfade.io');
    // Deduped: 5 unique candidates from 6 raw suggestions.
    expect(checkedNames).toHaveLength(5);
  });

  it('degrades to all-unavailable when RDAP cannot determine availability (all unknown)', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce({
        id: TEST_SITE_ID,
        business_name: 'Acme',
        business_address: null,
      })
      .mockResolvedValueOnce(null);

    const { app, env } = createAuthenticatedApp();
    (env.AI.run as jest.Mock).mockResolvedValue({ response: 'acmecafe.com\nbeanbar.io\n' });

    // RDAP hiccup → every domain comes back `unknown` (checkBatch never throws).
    mockCheckBatch.mockResolvedValue([
      rdap('acmecafe.com', 'unknown'),
      rdap('beanbar.io', 'unknown'),
    ]);

    const res = await app.request(
      `/api/sites/${TEST_SITE_ID}/domains/ai-search`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '' }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { available: unknown[]; unavailable: unknown[] };
    };
    // Unknown availability is treated as not-confirmed-available → all unavailable.
    expect(body.data.available).toEqual([]);
    expect(body.data.unavailable.length).toBeGreaterThan(0);
  });

  it('degrades gracefully when the availability check THROWS — must NOT 502 the whole search', async () => {
    // Availability enrichment is SECONDARY to the AI-generated candidates. If the
    // provider throws (RDAP fetch error, dynamic-import failure, provider rewire),
    // the handler's try/catch must swallow it and still 200 with every candidate —
    // never let a secondary-enrichment failure 502 the primary value. (Historic
    // prod bug: the old CF Registrar path threw AppError(502) on 404 and, before the
    // try/catch, hid every AI suggestion.)
    mockDbQueryOne
      .mockResolvedValueOnce({ id: TEST_SITE_ID, business_name: 'Acme', business_address: null })
      .mockResolvedValueOnce(null);

    const { app, env } = createAuthenticatedApp();
    (env.AI.run as jest.Mock).mockResolvedValue({ response: 'acmecafe.com\nbeanbar.io\n' });

    // checkBatch rejects — checkDomainAvailability propagates → handler try/catch swallows.
    mockCheckBatch.mockRejectedValue(new Error('rdap unreachable'));

    const res = await app.request(
      `/api/sites/${TEST_SITE_ID}/domains/ai-search`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '' }),
      },
      env,
    );
    expect(res.status).toBe(200); // NOT 502 — the search still returns its candidates
    const body = (await res.json()) as { data: { available: unknown[]; unavailable: unknown[] } };
    expect(body.data.available).toEqual([]);
    expect(body.data.unavailable.length).toBeGreaterThan(0); // AI candidates surfaced as unknown
  });
});
