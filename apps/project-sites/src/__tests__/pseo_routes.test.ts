/**
 * Route coverage for the **pSEO Matrix Builder** Hono routes (convergence r42).
 *
 * Exercises every handler in {@link pseoRoutes} end-to-end through the real
 * sub-app + the shared {@link errorHandler}, mocking only the boundaries: the
 * multi-tenant ownership guard ({@link assertSiteOwned}), the matrix-stats
 * service ({@link getPseoMatrixStats}), and the D1 query helpers ({@link dbQuery},
 * {@link dbQueryOne}, {@link dbUpdate}).
 *
 * The route has no flag gate of its own (gating is decided upstream), so the
 * covered surface is: auth (401), cross-tenant ownership (404 non-leak),
 * NOT_FOUND on missing rows, BAD_REQUEST (400) on unbuilt content, the
 * 503/500 workflow-binding error paths, and the success dispatch of each of
 * the 7 endpoints (stats, generate, list pages, get page, approve, publish,
 * reject).
 */

jest.mock('../services/site_ownership.js', () => ({
  assertSiteOwned: jest.fn(),
}));
jest.mock('../services/pseo_matrix.js', () => ({
  getPseoMatrixStats: jest.fn(),
}));
jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbUpdate: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { pseoRoutes } from '../routes/pseo.js';
import { assertSiteOwned } from '../services/site_ownership.js';
import { getPseoMatrixStats } from '../services/pseo_matrix.js';
import { dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';

const mockAssertSiteOwned = assertSiteOwned as unknown as jest.Mock;
const mockGetPseoMatrixStats = getPseoMatrixStats as unknown as jest.Mock;
const mockDbQuery = dbQuery as unknown as jest.Mock;
const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mockDbUpdate = dbUpdate as unknown as jest.Mock;

// ─── App harness ─────────────────────────────────────────────────────────────

/** R2 bucket mock so the publish handler's `.put(...)` resolves. */
function makeBucket() {
  return { put: jest.fn(async () => undefined) };
}

/** Workflow binding mock with a `create()` that returns an instance id. */
function makeWorkflow(opts: { throws?: boolean } = {}) {
  return {
    create: jest.fn(async () => {
      if (opts.throws) throw new Error('workflow create failed');
      return { id: 'wf-instance-1' };
    }),
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    SITES_BUCKET: makeBucket(),
    PSEO_GENERATION_WORKFLOW: makeWorkflow(),
    ...overrides,
  } as unknown as Env;
}

/**
 * Build the app mounted at `/api/pseo` with a middleware that seeds the auth
 * context vars. Passing no `userId` simulates an unauthenticated request.
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
  app.route('/api/pseo', pseoRoutes);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  method: 'GET' | 'POST',
  path: string,
  env: Env,
) {
  return app.request(
    path,
    { method, headers: { 'Content-Type': 'application/json' } },
    env,
    makeCtx(),
  );
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  // Default: caller owns the site. Individual tests override for the 404 path.
  mockAssertSiteOwned.mockResolvedValue(true);
});

// ─── GET /:siteId (matrix stats) ───────────────────────────────────────────────

describe('GET /api/pseo/:siteId', () => {
  it('returns 401 when unauthenticated and never touches the DB', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'GET', '/api/pseo/site-1', env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockAssertSiteOwned).not.toHaveBeenCalled();
    expect(mockGetPseoMatrixStats).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the site is not owned by the caller', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/foreign-site', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    // Must short-circuit before fetching stats.
    expect(mockGetPseoMatrixStats).not.toHaveBeenCalled();
  });

  it('returns 200 with the matrix stats on success', async () => {
    mockGetPseoMatrixStats.mockResolvedValue({ total: 12, published: 3 });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/site-1', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { siteId: string; stats: unknown };
    expect(json.siteId).toBe('site-1');
    expect(json.stats).toEqual({ total: 12, published: 3 });
    expect(mockGetPseoMatrixStats).toHaveBeenCalledWith(env, 'site-1');
  });

  it('returns 500 (via errorHandler) when the stats service throws', async () => {
    mockGetPseoMatrixStats.mockRejectedValue(new Error('boom'));
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/site-1', env);
    expect(res.status).toBe(500);
  });
});

// ─── POST /:siteId/generate (trigger workflow) ─────────────────────────────────

describe('POST /api/pseo/:siteId/generate', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'POST', '/api/pseo/site-1/generate', env);
    expect(res.status).toBe(401);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 when the site row does not belong to the org', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/foreign-site/generate', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('returns 503 when the workflow binding is unavailable', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'site-1' });
    const env = makeEnv({ PSEO_GENERATION_WORKFLOW: undefined });
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/generate', env);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('INTERNAL_ERROR');
  });

  it('returns 200 with the workflow instance id on success', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'site-1' });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/generate', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; workflowInstanceId: string };
    expect(json.ok).toBe(true);
    expect(json.workflowInstanceId).toBe('wf-instance-1');
    expect(
      (env.PSEO_GENERATION_WORKFLOW as unknown as { create: jest.Mock }).create,
    ).toHaveBeenCalledWith({ params: { siteId: 'site-1', orgId: 'org-1' } });
  });

  it('returns 500 when the workflow create() rejects', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'site-1' });
    const env = makeEnv({ PSEO_GENERATION_WORKFLOW: makeWorkflow({ throws: true }) });
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/generate', env);
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('INTERNAL_ERROR');
  });
});

// ─── GET /:siteId/pages (list) ─────────────────────────────────────────────────

describe('GET /api/pseo/:siteId/pages', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'GET', '/api/pseo/site-1/pages', env);
    expect(res.status).toBe(401);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the site is not owned', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/foreign-site/pages', env);
    expect(res.status).toBe(404);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('returns 200 with paginated rows + total (no status filter)', async () => {
    mockDbQuery.mockResolvedValue({ data: [{ id: 'p1' }, { id: 'p2' }] });
    mockDbQueryOne.mockResolvedValue({ cnt: 2 });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/site-1/pages', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      pages: Array<{ id: string }>;
      total: number;
      page: number;
      limit: number;
    };
    expect(json.pages).toHaveLength(2);
    expect(json.total).toBe(2);
    expect(json.page).toBe(1);
    expect(json.limit).toBe(50);
    // No status → query params arg (siteId, limit, offset).
    expect(mockDbQuery.mock.calls[0][2]).toEqual(['site-1', 50, 0]);
  });

  it('applies the status filter + page offset when query params are present', async () => {
    mockDbQuery.mockResolvedValue({ data: [] });
    mockDbQueryOne.mockResolvedValue({ cnt: 0 });
    const env = makeEnv();
    const res = await req(
      makeApp(AUTH),
      'GET',
      '/api/pseo/site-1/pages?status=approved&page=2',
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { page: number; total: number };
    expect(json.page).toBe(2);
    expect(json.total).toBe(0);
    // status present → params (siteId, status, limit, offset) with offset = 50.
    expect(mockDbQuery.mock.calls[0][2]).toEqual(['site-1', 'approved', 50, 50]);
  });

  it('coerces a missing total count to 0', async () => {
    mockDbQuery.mockResolvedValue({ data: [] });
    mockDbQueryOne.mockResolvedValue(null);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/site-1/pages', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { total: number };
    expect(json.total).toBe(0);
  });
});

// ─── GET /:siteId/pages/:pageId (detail) ───────────────────────────────────────

describe('GET /api/pseo/:siteId/pages/:pageId', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'GET', '/api/pseo/site-1/pages/p1', env);
    expect(res.status).toBe(401);
  });

  it('returns 404 (non-leak) when the site is not owned', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/foreign-site/pages/p1', env);
    expect(res.status).toBe(404);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 when the page row is missing', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/site-1/pages/missing', env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toBe('Page not found');
  });

  it('returns 200 with the page on success', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'p1', route_slug: '/plumber/newark' });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'GET', '/api/pseo/site-1/pages/p1', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { page: { id: string } };
    expect(json.page.id).toBe('p1');
    // Scoped to both pageId AND siteId.
    expect(mockDbQueryOne.mock.calls[0][2]).toEqual(['p1', 'site-1']);
  });
});

// ─── POST /:siteId/pages/:pageId/approve ───────────────────────────────────────

describe('POST /api/pseo/:siteId/pages/:pageId/approve', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'POST', '/api/pseo/site-1/pages/p1/approve', env);
    expect(res.status).toBe(401);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the site is not owned', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/foreign/pages/p1/approve', env);
    expect(res.status).toBe(404);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('returns 200 and scopes the update to id + site_id', async () => {
    mockDbUpdate.mockResolvedValue(undefined);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/pages/p1/approve', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; status: string };
    expect(json.ok).toBe(true);
    expect(json.status).toBe('approved');
    expect(mockDbUpdate).toHaveBeenCalledWith(
      env.DB,
      'pseo_pages',
      { status: 'approved' },
      'id = ? AND site_id = ?',
      ['p1', 'site-1'],
    );
  });
});

// ─── POST /:siteId/pages/:pageId/publish ───────────────────────────────────────

describe('POST /api/pseo/:siteId/pages/:pageId/publish', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'POST', '/api/pseo/site-1/pages/p1/publish', env);
    expect(res.status).toBe(401);
  });

  it('returns 404 (non-leak) when the site is not owned', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/foreign/pages/p1/publish', env);
    expect(res.status).toBe(404);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 when the page row is missing', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/pages/missing/publish', env);
    expect(res.status).toBe(404);
  });

  it('returns 400 when the page has no generated html_content', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'p1', html_content: null, route_slug: '/x', status: 'draft' });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/pages/p1/publish', env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 when the site slug lookup fails after the page check', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce({ id: 'p1', html_content: '<p>hi</p>', route_slug: '/x', status: 'draft' })
      .mockResolvedValueOnce(null); // site slug lookup
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/pages/p1/publish', env);
    expect(res.status).toBe(404);
  });

  it('returns 200, writes to R2, and flips the row to published', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce({
        id: 'p1',
        html_content: '<p>hello</p>',
        route_slug: '/plumber/newark',
        status: 'approved',
      })
      .mockResolvedValueOnce({ slug: 'vitos' }); // site slug lookup
    mockDbUpdate.mockResolvedValue(undefined);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/pages/p1/publish', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; r2Key: string };
    expect(json.ok).toBe(true);
    expect(json.r2Key).toBe('sites/vitos/latest/plumber/newark/index.html');
    const bucket = env.SITES_BUCKET as unknown as { put: jest.Mock };
    expect(bucket.put).toHaveBeenCalledTimes(1);
    expect(bucket.put.mock.calls[0][0]).toBe('sites/vitos/latest/plumber/newark/index.html');
    // The published HTML embeds the stored content.
    expect(String(bucket.put.mock.calls[0][1])).toContain('<p>hello</p>');
    expect(mockDbUpdate).toHaveBeenCalledWith(
      env.DB,
      'pseo_pages',
      expect.objectContaining({ status: 'published', r2_path: 'sites/vitos/latest/plumber/newark/index.html' }),
      'id = ?',
      ['p1'],
    );
  });
});

// ─── POST /:siteId/pages/:pageId/reject ────────────────────────────────────────

describe('POST /api/pseo/:siteId/pages/:pageId/reject', () => {
  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), 'POST', '/api/pseo/site-1/pages/p1/reject', env);
    expect(res.status).toBe(401);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the site is not owned', async () => {
    mockAssertSiteOwned.mockResolvedValue(false);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/foreign/pages/p1/reject', env);
    expect(res.status).toBe(404);
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('returns 200 and scopes the update to id + site_id', async () => {
    mockDbUpdate.mockResolvedValue(undefined);
    const env = makeEnv();
    const res = await req(makeApp(AUTH), 'POST', '/api/pseo/site-1/pages/p1/reject', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; status: string };
    expect(json.ok).toBe(true);
    expect(json.status).toBe('rejected');
    expect(mockDbUpdate).toHaveBeenCalledWith(
      env.DB,
      'pseo_pages',
      { status: 'rejected' },
      'id = ? AND site_id = ?',
      ['p1', 'site-1'],
    );
  });
});
