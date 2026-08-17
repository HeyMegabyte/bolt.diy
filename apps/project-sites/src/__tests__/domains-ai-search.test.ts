/**
 * @module __tests__/domains-ai-search
 * @description Unit tests for the AI-powered creative domain search route.
 *
 * Verifies that:
 *  1. Workers AI fan-out aggregates candidates across multiple strategies.
 *  2. Duplicate candidates from different strategies are deduped.
 *  3. The Cloudflare Registrar bulk-check merges availability + pricing
 *     correctly and slots each candidate into `available` vs `unavailable`.
 *  4. Soft-failures (5xx from CF Registrar) degrade to "all unknown" rather
 *     than throwing.
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

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { dbQueryOne } from '../services/db.js';

const mockDbQueryOne = dbQueryOne as jest.Mock;

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

    // Mock the Cloudflare Registrar bulk-check.
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        result: [
          { name: 'vitossalon.com', available: false, price: 9.77 },
          { name: 'mensbarber.com', available: true, price: 9.77 },
          { name: 'ironpaw.com', available: true, price: 9.77 },
          { name: 'blademaster.dev', available: true, price: 14.0 },
          { name: 'sharpfade.io', available: false, price: 39.0 },
        ],
      }),
      text: jest.fn().mockResolvedValue(''),
    }) as unknown as typeof fetch;

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

    // CF Registrar was called exactly once with the deduped candidate list.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const callUrl = (globalThis.fetch as jest.Mock).mock.calls[0]?.[0] as string;
    expect(callUrl).toContain('/registrar/domains/check');
    expect(callUrl).toContain('vitossalon.com');
  });

  it('degrades to all-unknown when Cloudflare Registrar returns 5xx', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce({
        id: TEST_SITE_ID,
        business_name: 'Acme',
        business_type: 'cafe',
        business_address: null,
      })
      .mockResolvedValueOnce(null);

    const { app, env } = createAuthenticatedApp();
    (env.AI.run as jest.Mock).mockResolvedValue({ response: 'acmecafe.com\nbeanbar.io\n' });

    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({}),
      text: jest.fn().mockResolvedValue('upstream timeout'),
    }) as unknown as typeof fetch;

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
    // Every candidate should be marked unavailable when CF is down.
    expect(body.data.available).toEqual([]);
    expect(body.data.unavailable.length).toBeGreaterThan(0);
  });

  it('degrades to all-unknown when the availability check THROWS (CF Registrar 404) — was 502ing the whole search', async () => {
    // Prod reality: the CF Registrar availability API returns 404, and
    // checkDomainAvailability THROWS an AppError(502) on 404 (unlike 5xx, which it
    // returns-gracefully). Before the handler wrapped it in try/catch, that throw
    // propagated → 502 → every AI-generated candidate was hidden. The AI suggestions
    // are the PRIMARY value; availability is secondary enrichment → must still 200.
    mockDbQueryOne
      .mockResolvedValueOnce({ id: TEST_SITE_ID, business_name: 'Acme', business_address: null })
      .mockResolvedValueOnce(null);

    const { app, env } = createAuthenticatedApp();
    (env.AI.run as jest.Mock).mockResolvedValue({ response: 'acmecafe.com\nbeanbar.io\n' });

    // 404 with success:false — the shape that makes checkDomainAvailability throw.
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue({ result: null, success: false, errors: [{ code: 7003 }] }),
      text: jest.fn().mockResolvedValue('{"result":null,"success":false}'),
    }) as unknown as typeof fetch;

    const res = await app.request(
      `/api/sites/${TEST_SITE_ID}/domains/ai-search`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '' }) },
      env,
    );
    expect(res.status).toBe(200); // NOT 502 — the search still returns its candidates
    const body = (await res.json()) as { data: { available: unknown[]; unavailable: unknown[] } };
    expect(body.data.available).toEqual([]);
    expect(body.data.unavailable.length).toBeGreaterThan(0); // AI candidates surfaced as unknown
  });
});
