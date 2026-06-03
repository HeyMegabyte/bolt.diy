/**
 * Route coverage for the Review/Approval Links admin API (convergence r39).
 *
 * Exercises both handlers end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries (feature flag, site
 * ownership, review_approval service). The handlers gate on
 * auth → `isFlagOn('approval_workflow')` → `assertSiteOwned` (404, never 403,
 * so feature existence never leaks), then delegate to the service.
 *
 * Covers, per the route surface (GET list + POST create):
 *  - GET  list:   auth 401 · flag-off 404 · foreign/missing site 404 · success 200
 *  - POST create: auth 401 · flag-off 404 · foreign/missing site 404 · Zod 400
 *                 (bad ttlDays + unknown key) · success 200 · ttl conversion · 500
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));

jest.mock('../services/site_ownership.js', () => ({
  assertSiteOwned: jest.fn(),
}));

jest.mock('../services/review_approval.js', () => ({
  createReviewLink: jest.fn(),
  listReviewLinks: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { reviewLinks } from '../routes/review_links.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import { createReviewLink, listReviewLinks } from '../services/review_approval.js';

const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockAssertSiteOwned = assertSiteOwned as unknown as jest.Mock;
const mockCreateReviewLink = createReviewLink as unknown as jest.Mock;
const mockListReviewLinks = listReviewLinks as unknown as jest.Mock;

// ─── Harness ───────────────────────────────────────────────────────────────

function makeEnv(): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
  } as unknown as Env;
}

/**
 * Build the app with a middleware that seeds the auth context vars the
 * handler reads (`userId`, `orgId`). Passing no vars simulates an
 * unauthenticated request (the gate returns 401).
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', reviewLinks);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

const SITE_ID = 'site-123';
const PATH = `/api/sites/${SITE_ID}/review-links`;
const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

function get(app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env) {
  return app.request(PATH, { method: 'GET' }, env, makeCtx());
}

function post(app: Hono<{ Bindings: Env; Variables: Variables }>, body: unknown, env: Env) {
  return app.request(
    PATH,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    makeCtx(),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default-happy gate: flag on, site owned.
  mockIsFlagOn.mockResolvedValue(true);
  mockAssertSiteOwned.mockResolvedValue(true);
});

// ─── GET /api/sites/:siteId/review-links ─────────────────────────────────────

describe('GET /api/sites/:siteId/review-links', () => {
  it('returns 401 when the request is unauthenticated', async () => {
    const env = makeEnv();
    const res = await get(makeApp(), env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    // Short-circuits before the flag check, ownership, or the service.
    expect(mockIsFlagOn).not.toHaveBeenCalled();
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockListReviewLinks).not.toHaveBeenCalled();
  });

  it('returns 404 (not 403) when the approval_workflow flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockIsFlagOn).toHaveBeenCalledWith(env, 'approval_workflow', { siteId: SITE_ID, orgId: 'org-1' });
    // Never reaches the ownership check or the service when the flag is off.
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockListReviewLinks).not.toHaveBeenCalled();
  });

  it('returns 404 (not 403, no leak) for a foreign or missing site', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockAssertSiteOwned).toHaveBeenCalledWith(env, 'org-1', SITE_ID);
    expect(mockListReviewLinks).not.toHaveBeenCalled();
  });

  it('returns 200 with the links from the service on success', async () => {
    const links = [
      { id: 'rl-1', status: 'pending', url: '/review/rl-1', expiresAt: '2026-07-01T00:00:00.000Z', usedAt: null },
      { id: 'rl-2', status: 'approved', url: '/review/rl-2', expiresAt: '2026-06-01T00:00:00.000Z', usedAt: '2026-05-30T00:00:00.000Z' },
    ];
    mockListReviewLinks.mockResolvedValue(links);
    const env = makeEnv();
    const res = await get(makeApp(AUTH), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; links: typeof links };
    expect(json.ok).toBe(true);
    expect(json.links).toEqual(links);
    expect(mockListReviewLinks).toHaveBeenCalledWith(env, 'org-1', SITE_ID);
  });
});

// ─── POST /api/sites/:siteId/review-links ────────────────────────────────────

describe('POST /api/sites/:siteId/review-links', () => {
  it('returns 401 when the request is unauthenticated', async () => {
    const env = makeEnv();
    const res = await post(makeApp(), {}, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockCreateReviewLink).not.toHaveBeenCalled();
  });

  it('returns 404 (not 403) when the approval_workflow flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const env = makeEnv();
    const res = await post(makeApp(AUTH), {}, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockCreateReviewLink).not.toHaveBeenCalled();
  });

  it('returns 404 (not 403, no leak) for a foreign or missing site', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await post(makeApp(AUTH), {}, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockCreateReviewLink).not.toHaveBeenCalled();
  });

  it('returns 400 when ttlDays is out of range (Zod)', async () => {
    const env = makeEnv();
    const res = await post(makeApp(AUTH), { ttlDays: 999 }, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    // Gate passed (flag + ownership) but the body was rejected before the service.
    expect(mockCreateReviewLink).not.toHaveBeenCalled();
  });

  it('returns 400 when an unknown key is sent (strict schema)', async () => {
    const env = makeEnv();
    const res = await post(makeApp(AUTH), { ttlDays: 7, bogus: true }, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(mockCreateReviewLink).not.toHaveBeenCalled();
  });

  it('treats a non-JSON body as an empty (valid) create with the default ttl', async () => {
    // `c.req.json().catch(() => ({}))` yields `{}`, which passes the optional
    // schema — so a non-JSON body is a VALID create with the service default.
    const env = makeEnv();
    mockCreateReviewLink.mockResolvedValue({ ok: true, id: 'rl-x', url: '/review/rl-x', expiresAt: '2026-07-01T00:00:00.000Z' });
    const res = await makeApp(AUTH).request(
      PATH,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' },
      env,
      makeCtx(),
    );
    expect(res.status).toBe(200);
    expect(mockCreateReviewLink).toHaveBeenCalledWith(env, 'org-1', SITE_ID, {});
  });

  it('returns 200 with the created link (default ttl) on success', async () => {
    const created = { ok: true, id: 'rl-new', url: '/review/rl-new', expiresAt: '2026-07-08T00:00:00.000Z' };
    mockCreateReviewLink.mockResolvedValue(created);
    const env = makeEnv();
    const res = await post(makeApp(AUTH), {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; id: string; url: string; expiresAt: string };
    expect(json).toEqual(created);
    // No ttlDays → ttlMs omitted → service called with `{}`.
    expect(mockCreateReviewLink).toHaveBeenCalledWith(env, 'org-1', SITE_ID, {});
  });

  it('converts ttlDays to ttlMs and forwards it to the service', async () => {
    const created = { ok: true, id: 'rl-ttl', url: '/review/rl-ttl', expiresAt: '2026-06-15T00:00:00.000Z' };
    mockCreateReviewLink.mockResolvedValue(created);
    const env = makeEnv();
    const res = await post(makeApp(AUTH), { ttlDays: 14 }, env);
    expect(res.status).toBe(200);
    // 14 days × 86_400_000 ms.
    expect(mockCreateReviewLink).toHaveBeenCalledWith(env, 'org-1', SITE_ID, { ttlMs: 14 * 86_400_000 });
  });

  it('returns 500 with the service error when createReviewLink fails', async () => {
    mockCreateReviewLink.mockResolvedValue({ ok: false, error: 'D1 insert failed' });
    const env = makeEnv();
    const res = await post(makeApp(AUTH), { ttlDays: 7 }, env);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('INTERNAL_ERROR');
    expect(json.error?.message).toBe('D1 insert failed');
  });

  it('returns 500 with a fallback message when the service fails without an error string', async () => {
    mockCreateReviewLink.mockResolvedValue({ ok: false });
    const env = makeEnv();
    const res = await post(makeApp(AUTH), {}, env);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('INTERNAL_ERROR');
    expect(json.error?.message).toBe('Could not create review link');
  });
});
