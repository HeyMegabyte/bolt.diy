/**
 * @module __tests__/agency_routes
 * @description Route coverage for the white-label / agency surface
 * (`src/routes/agency.ts`, convergence r41). ADDITIVE — siblings own other routes.
 *
 * Exercises every handler end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries (`services/db.js`,
 * `services/pro.js`). Covers:
 *   - Pro gate (402 PRO_REQUIRED) — the `requirePro` middleware
 *   - Auth (401 UNAUTHORIZED) — missing org/user context behind a Pro pass-through
 *   - Zod validation (400 BAD_REQUEST) on the three mutating handlers
 *   - Org scoping — every query/insert/update is bound to the caller's `orgId`
 *     (no cross-tenant leak: clients are filtered by `parent_org_id = orgId`)
 *   - Success + the JSON-parse error path on the brand reader
 *
 * `pro.js` toggles between a pass-through (exercise the handler) and the real
 * 402 (exercise the billing gate). `db.js` is fully mocked — no real D1.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

// Default: Pro pass-through so handler logic is reachable. Individual tests can
// re-mock the implementation to assert the 402 gate.
jest.mock('../services/pro.js', () => ({
  requirePro: jest.fn(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  }),
}));

import { Hono } from 'hono';
import type { Context } from 'hono';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { requirePro } from '../services/pro.js';
import { agency } from '../routes/agency.js';
import { errorHandler } from '../middleware/error_handler.js';
import type { Env, Variables } from '../types/env.js';

const mockQuery = dbQuery as unknown as jest.Mock;
const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockInsert = dbInsert as unknown as jest.Mock;
const mockUpdate = dbUpdate as unknown as jest.Mock;
const mockRequirePro = requirePro as unknown as jest.Mock;

/** Pass-through implementation for `requirePro` (restored before each test). */
function proPassThrough() {
  mockRequirePro.mockImplementation(async (_c: unknown, next: () => Promise<void>) => {
    await next();
  });
}

/** 402 implementation for `requirePro` — mirrors the real billing gate. */
function proBlocks() {
  mockRequirePro.mockImplementation(
    async (c: Context<{ Bindings: Env; Variables: Variables }>) =>
      c.json(
        {
          error: {
            code: 'PRO_REQUIRED',
            message: 'This feature is included in Project Sites Pro ($50/mo).',
            upgrade_url: '/admin/billing?plan=pro',
          },
        },
        402,
      ),
  );
}

/** A minimal KV mock so `CACHE_KV.delete(...)` in the brand-PUT handler works. */
function makeKv() {
  return {
    get: jest.fn(async () => null),
    put: jest.fn(async () => undefined),
    delete: jest.fn(async () => undefined),
  };
}

/**
 * Build the app with a middleware that seeds the auth context vars
 * (`userId`, `orgId`, `requestId`). Passing no ids simulates an authed-Pro
 * user whose org/user context never got set (the 401 path inside handlers).
 */
function makeApp(ids?: { userId?: string; orgId?: string }, kv = makeKv()) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (ids?.userId) c.set('userId', ids.userId);
    if (ids?.orgId) c.set('orgId', ids.orgId);
    c.set('requestId', 'req-agency');
    await next();
  });
  app.route('/', agency);
  const env = { DB: {} as D1Database, CACHE_KV: kv, ENVIRONMENT: 'test' } as unknown as Env;
  const ctx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const request = (path: string, init?: RequestInit) => app.request(path, init, env, ctx);
  return { request, env, kv };
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const AUTH = { userId: 'user-1', orgId: 'org-1' };

beforeEach(() => {
  jest.clearAllMocks();
  proPassThrough();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

describe('agency routes — Pro gate (402)', () => {
  it.each([
    ['GET', '/api/agency/whoami'],
    ['GET', '/api/agency/clients'],
    ['GET', '/api/agency/brand'],
    ['GET', '/api/agency/snapshots'],
  ])('returns 402 PRO_REQUIRED for %s %s when the caller is not Pro', async (method, path) => {
    proBlocks();
    const { request } = makeApp(AUTH);
    const res = await request(path, { method });
    expect(res.status).toBe(402);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('PRO_REQUIRED');
    // Gated before any DB access.
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 402 for POST /api/agency/clients when not Pro (before Zod)', async () => {
    proBlocks();
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/clients', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'client@acme.test' }),
    });
    expect(res.status).toBe(402);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/agency/whoami', () => {
  it('returns 401 UNAUTHORIZED when org/user context is missing', async () => {
    const { request } = makeApp(); // Pro pass-through, but no userId/orgId set
    const res = await request('/api/agency/whoami');
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('returns 200 with the resolved agency org scoped to the caller orgId', async () => {
    mockQueryOne.mockResolvedValue({
      id: 'org-1',
      name: 'Acme Agency',
      is_agency: 1,
      agency_tier: 'pro',
      custom_admin_hostname: 'admin.acme.test',
      markup_pct: 15,
      brand_overrides_json: null,
    });
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/whoami');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { org: { id: string }; user_id: string };
    expect(json.org.id).toBe('org-1');
    expect(json.user_id).toBe('user-1');
    // The org lookup is bound to the caller's orgId — no cross-tenant read.
    expect(mockQueryOne.mock.calls[0][2]).toEqual(['org-1']);
  });

  it('surfaces the org as null when the row does not exist', async () => {
    mockQueryOne.mockResolvedValue(null);
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/whoami');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { org: unknown };
    expect(json.org).toBeNull();
  });
});

describe('GET /api/agency/clients', () => {
  it('returns 401 when org context is missing', async () => {
    const { request } = makeApp();
    const res = await request('/api/agency/clients');
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lists only child orgs of the caller (parent_org_id = orgId)', async () => {
    mockQuery.mockResolvedValue({
      data: [
        { id: 'c1', name: 'Client One', slug: 'client-one', created_at: 'now', site_count: 3 },
        { id: 'c2', name: 'Client Two', slug: 'client-two', created_at: 'now', site_count: 0 },
      ],
      error: null,
    });
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/clients');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { clients: Array<{ id: string }> };
    expect(json.clients).toHaveLength(2);
    // The org-scope binding prevents listing a foreign agency's clients.
    expect(mockQuery.mock.calls[0][2]).toEqual(['org-1']);
    expect(mockQuery.mock.calls[0][1]).toContain('parent_org_id = ?');
  });

  it('returns an empty list when the agency owns no clients', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/clients');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { clients: unknown[] };
    expect(json.clients).toEqual([]);
  });
});

describe('POST /api/agency/clients (invite)', () => {
  it('returns 401 when org/user context is missing', async () => {
    const { request } = makeApp();
    const res = await request('/api/agency/clients', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'client@acme.test' }),
    });
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 400 BAD_REQUEST when the email is missing', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/clients', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    // Bare `zValidator('json', …)` short-circuits with Hono's default 400 body
    // (`{ success:false, error:{ name:'ZodError', issues } }`) — not routed
    // through the app envelope. The handler never runs, so no insert fires.
    const json = (await res.json()) as { success?: boolean; error?: { name?: string } };
    expect(json.success).toBe(false);
    expect(json.error?.name).toBe('ZodError');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when the email is malformed', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/clients', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns 400 when the role is outside the allowed enum', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/clients', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'client@acme.test', role: 'super_admin' }),
    });
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('creates an invitation scoped to the caller agency org and returns a token', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/clients', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email: 'client@acme.test', preselected_template_id: 'tpl-9' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { invitation_id: string; token: string; expires_at: string };
    expect(json.invitation_id).toBeTruthy();
    expect(json.token).toBeTruthy();
    expect(json.expires_at).toBeTruthy();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const [, table, record] = mockInsert.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(table).toBe('agency_invitations');
    expect(record.agency_org_id).toBe('org-1'); // bound to caller's org
    expect(record.client_email).toBe('client@acme.test');
    expect(record.role).toBe('client_owner'); // default applied
    expect(record.preselected_template_id).toBe('tpl-9');
    // Token is hashed at rest — the raw token is never the stored value.
    expect(record.token_hash).not.toBe(json.token);
    expect(String(record.token_hash)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('GET /api/agency/brand', () => {
  it('returns 401 when org context is missing', async () => {
    const { request } = makeApp();
    const res = await request('/api/agency/brand');
    expect(res.status).toBe(401);
  });

  it('returns an empty brand object when no overrides exist', async () => {
    mockQueryOne.mockResolvedValue({ brand_overrides_json: null });
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/brand');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { brand: Record<string, unknown> };
    expect(json.brand).toEqual({});
    expect(mockQueryOne.mock.calls[0][2]).toEqual(['org-1']);
  });

  it('parses and returns stored brand override JSON', async () => {
    mockQueryOne.mockResolvedValue({
      brand_overrides_json: JSON.stringify({ appName: 'Acme', hideBranding: true }),
    });
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/brand');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { brand: { appName?: string; hideBranding?: boolean } };
    expect(json.brand.appName).toBe('Acme');
    expect(json.brand.hideBranding).toBe(true);
  });

  it('returns 500 INTERNAL when the stored brand JSON is corrupt', async () => {
    mockQueryOne.mockResolvedValue({ brand_overrides_json: '{not valid json' });
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/brand');
    // JSON.parse throws → caught by the shared error handler as a 500.
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/agency/brand', () => {
  it('returns 401 when org context is missing', async () => {
    const { request } = makeApp();
    const res = await request('/api/agency/brand', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ appName: 'Acme' }),
    });
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when a color override is not a 6-digit hex', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/brand', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ primaryColor: 'red' }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { success?: boolean; error?: { name?: string } };
    expect(json.success).toBe(false);
    expect(json.error?.name).toBe('ZodError');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when fromEmail is not a valid email', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/brand', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ fromEmail: 'nope' }),
    });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('merges onto existing overrides, persists scoped to orgId, and busts the brand cache', async () => {
    mockQueryOne.mockResolvedValue({
      brand_overrides_json: JSON.stringify({ appName: 'Old', accentColor: '#abcdef' }),
    });
    const kv = makeKv();
    const { request } = makeApp(AUTH, kv);
    const res = await request('/api/agency/brand', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ appName: 'New', hideBranding: true }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { brand: Record<string, unknown> };
    // New keys win; untouched keys survive the merge.
    expect(json.brand.appName).toBe('New');
    expect(json.brand.accentColor).toBe('#abcdef');
    expect(json.brand.hideBranding).toBe(true);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, table, , whereClause, whereParams] = mockUpdate.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
      string,
      unknown[],
    ];
    expect(table).toBe('orgs');
    expect(whereClause).toBe('id = ?');
    expect(whereParams).toEqual(['org-1']); // scoped to caller's org
    // KV brand cache for this org is invalidated.
    expect(kv.delete).toHaveBeenCalledWith('brand:org-1');
  });

  it('still succeeds when the brand KV cache delete throws (best-effort)', async () => {
    mockQueryOne.mockResolvedValue({ brand_overrides_json: null });
    const kv = makeKv();
    kv.delete.mockRejectedValue(new Error('KV down'));
    const { request } = makeApp(AUTH, kv);
    const res = await request('/api/agency/brand', {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ appName: 'Acme' }),
    });
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/agency/upgrade', () => {
  it('returns 401 when org context is missing', async () => {
    const { request } = makeApp();
    const res = await request('/api/agency/upgrade', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tier: 'pro' }),
    });
    expect(res.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when the tier is outside the allowed enum', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/upgrade', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tier: 'enterprise' }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { success?: boolean; error?: { name?: string } };
    expect(json.success).toBe(false);
    expect(json.error?.name).toBe('ZodError');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when markup_pct exceeds the max', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/upgrade', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tier: 'pro', markup_pct: 150 }),
    });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('flips the org to an agency with the selected tier + default markup, scoped to orgId', async () => {
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/upgrade', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ tier: 'scale' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; tier: string; markup_pct: number };
    expect(json.ok).toBe(true);
    expect(json.tier).toBe('scale');
    expect(json.markup_pct).toBe(0); // default applied
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, table, updates, whereClause, whereParams] = mockUpdate.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
      string,
      unknown[],
    ];
    expect(table).toBe('orgs');
    expect(updates).toMatchObject({ is_agency: 1, agency_tier: 'scale', markup_pct: 0 });
    expect(whereClause).toBe('id = ?');
    expect(whereParams).toEqual(['org-1']);
  });
});

describe('GET /api/agency/snapshots', () => {
  it('returns 401 when org context is missing', async () => {
    const { request } = makeApp();
    const res = await request('/api/agency/snapshots');
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('lists the agency-owned + global snapshots scoped by author_org_id', async () => {
    mockQuery.mockResolvedValue({
      data: [
        { id: 't1', slug: 'cafe', name: 'Cafe', category: 'restaurant', install_count: 12, price_cents: 0 },
        { id: 't2', slug: 'law', name: 'Law', category: 'legal', install_count: 4, price_cents: 4900 },
      ],
      error: null,
    });
    const { request } = makeApp(AUTH);
    const res = await request('/api/agency/snapshots');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { snapshots: Array<{ id: string }> };
    expect(json.snapshots).toHaveLength(2);
    // Query binds the caller orgId; global templates (author_org_id IS NULL) are unioned in SQL.
    expect(mockQuery.mock.calls[0][2]).toEqual(['org-1']);
    expect(mockQuery.mock.calls[0][1]).toContain('author_org_id');
  });
});
