/**
 * @module __tests__/experiments
 * @description Route-layer tests for the A/B-testing + predictive-prerender
 * module (#experiments). Focus: the multi-tenant gate on the Pro admin routes
 * returns **404 (never 403)** for a site/experiment the caller's org doesn't
 * own — a 403 would confirm the resource exists to a probing caller. Also locks
 * the public beacon endpoints (anonymous, fire-and-forget 204) + the Beta-mean
 * winner selection in `promote`.
 *
 * `requirePro` is mocked to a pass-through so these tests exercise the ownership
 * gate, not the billing gate (which has its own coverage).
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/pro.js', () => ({
  requirePro: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { Hono } from 'hono';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { experiments } from '../routes/experiments.js';
import { errorHandler } from '../middleware/error_handler.js';
import type { Env, Variables } from '../types/env.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

/** DB double for the public beacons (raw `prepare().bind().run()`). */
const beaconDb = () =>
  ({
    prepare: () => ({ bind: () => ({ run: async () => ({ meta: {} }) }) }),
  }) as unknown as Env['DB'];

/**
 * Build a test app + a `request` helper. The helper passes the Worker
 * `executionCtx` as the 4th positional arg to `app.request` (Hono reads
 * `c.executionCtx` from there — NOT from `env`), so the `waitUntil`-based
 * fire-and-forget beacons don't throw "no ExecutionContext".
 */
function app(ids?: { userId?: string; orgId?: string }, db: unknown = beaconDb()) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    if (ids?.userId) c.set('userId', ids.userId);
    if (ids?.orgId) c.set('orgId', ids.orgId);
    c.set('requestId', 'test-req');
    await next();
  });
  a.onError(errorHandler);
  a.route('/', experiments);
  const env = { DB: db } as unknown as Env;
  const ctx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const request = (path: string, init?: RequestInit) => a.request(path, init, env, ctx);
  return { request };
}

const json = { 'content-type': 'application/json' };

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — clearAllMocks does NOT drain
  // `mockResolvedValueOnce` queues, so an unconsumed `once` (e.g. a 400 that
  // short-circuits before the ownership check) would leak into the next test.
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

// ─── Public beacons (anonymous, 204) ─────────────────────────────────
describe('public beacons', () => {
  it('POST /_ps/i → 204 on a valid impression', async () => {
    const { request } = app();
    const res = await request('/_ps/i', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ eid: 'e', vid: 'v', sid: 's', variant: 'x' }),
    });
    expect(res.status).toBe(204);
  });

  it('POST /_ps/i → 400 on an invalid body', async () => {
    const { request } = app();
    const res = await request('/_ps/i', { method: 'POST', headers: json, body: '{}' });
    expect(res.status).toBe(400);
  });

  it('GET /_ps/predict → empty predictions when sid missing', async () => {
    const { request } = app();
    const res = await request('/_ps/predict');
    expect(res.status).toBe(200);
    expect((await res.json()) as { predictions: unknown[] }).toEqual({ predictions: [] });
  });
});

// ─── GET experiments (ownership gate → 404 never 403) ────────────────
describe('GET /api/sites/:siteId/experiments (tenant isolation)', () => {
  it('401 when unauthenticated', async () => {
    const { request } = app(undefined, {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    });
    const res = await request('/api/sites/site1/experiments');
    expect(res.status).toBe(401);
  });

  it('404 (NOT 403) for a site owned by another org', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never); // assertSiteOwnership
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/sites/site1/experiments');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND'); // never FORBIDDEN — don't leak existence
    expect(mockQuery).not.toHaveBeenCalled(); // experiment list never runs for a foreign site
  });

  it('404 for a non-existent site', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no site row
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/sites/site1/experiments')).status).toBe(404);
  });

  it('200 lists experiments for an org-owned site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never); // owned
    mockQuery.mockResolvedValueOnce({ data: [{ id: 'e1', name: 'Hero copy' }], error: null });
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/sites/site1/experiments');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { experiments: unknown[] }).experiments).toHaveLength(1);
  });
});

// ─── POST create experiment (ownership gate) ─────────────────────────
describe('POST /api/sites/:siteId/experiments', () => {
  const body = JSON.stringify({
    name: 'Hero test',
    surface: 'hero',
    variants: [
      { name: 'A', payload: {}, is_control: true },
      { name: 'B', payload: {} },
    ],
  });

  it('404 creating on a foreign site (no insert)', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/sites/site1/experiments', {
      method: 'POST',
      headers: json,
      body,
    });
    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('201 + inserts experiment and both variants for an owned site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/sites/site1/experiments', {
      method: 'POST',
      headers: json,
      body,
    });
    expect(res.status).toBe(201);
    // 1 experiment insert + 2 variant inserts.
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });

  it('400 with fewer than 2 variants', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const bad = JSON.stringify({
      name: 'x',
      surface: 'hero',
      variants: [{ name: 'A', payload: {} }],
    });
    const res = await request('/api/sites/site1/experiments', {
      method: 'POST',
      headers: json,
      body: bad,
    });
    expect(res.status).toBe(400);
  });
});

// ─── POST promote (ownership JOIN → 404, Beta-mean winner) ───────────
describe('POST /api/experiments/:id/promote', () => {
  it('404 (NOT 403) when the experiment is not owned by the caller org', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // JOIN with s.org_id finds nothing
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/experiments/e1/promote', { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('promotes the highest Beta-mean variant for an owned experiment', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'e1', site_id: 'site1' } as never); // owned
    mockQuery.mockResolvedValueOnce({
      data: [
        { id: 'vA', beta_alpha: 2, beta_beta: 8 }, // mean 0.2
        { id: 'vB', beta_alpha: 9, beta_beta: 1 }, // mean 0.9 ← winner
      ],
      error: null,
    });
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/experiments/e1/promote', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { promoted_variant_id: string }).promoted_variant_id).toBe('vB');
    const [, , updates] = mockUpdate.mock.calls[0]!;
    expect(updates).toMatchObject({ status: 'promoted', promoted_variant_id: 'vB' });
  });

  it('401 when unauthenticated', async () => {
    const { request } = app();
    expect((await request('/api/experiments/e1/promote', { method: 'POST' })).status).toBe(401);
  });
});
