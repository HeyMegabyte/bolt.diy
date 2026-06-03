/**
 * Route coverage for the Content Freshness API (`/api/content/freshness/*`,
 * convergence r38).
 *
 * Exercises every handler end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries (D1 query helpers + the
 * content_freshness service). Covers: list/detail/approve/reject/trigger, auth
 * 401, site-ownership 404 (non-leaking), success, and error paths.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbUpdate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/content_freshness.js', () => ({
  publishRewriteDraft: jest.fn(),
  scheduledContentFreshness: jest.fn().mockResolvedValue(undefined),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { contentRoutes } from '../routes/content.js';
import { dbQuery, dbQueryOne, dbUpdate } from '../services/db.js';
import { publishRewriteDraft, scheduledContentFreshness } from '../services/content_freshness.js';

const mockDbQuery = dbQuery as unknown as jest.Mock;
const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mockDbUpdate = dbUpdate as unknown as jest.Mock;
const mockPublish = publishRewriteDraft as unknown as jest.Mock;
const mockScheduled = scheduledContentFreshness as unknown as jest.Mock;

// ─── Env + app harness ─────────────────────────────────────────────────────────

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: {} as D1Database } as unknown as Env;
}

/**
 * Mount the routes under `/api/content` (matching the production mount) behind
 * a middleware that seeds the auth context vars the handlers read. Passing no
 * vars simulates an unauthenticated request.
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
  app.route('/api/content', contentRoutes);
  return app;
}

/** ExecutionContext so the trigger handler's `waitUntil(...)` works. */
function makeCtx(): ExecutionContext {
  const waitUntil = jest.fn((_p: Promise<unknown>) => {});
  return {
    waitUntil,
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  method: 'GET' | 'POST',
  env: Env,
  ctx: ExecutionContext = makeCtx(),
) {
  return app.request(path, { method }, env, ctx);
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockDbUpdate.mockResolvedValue(undefined);
  mockScheduled.mockResolvedValue(undefined);
});

// ─── GET /api/content/freshness (list) ─────────────────────────────────────────

describe('GET /api/content/freshness', () => {
  it('returns 401 when unauthenticated and never touches D1', async () => {
    const env = makeEnv();
    const res = await req(makeApp(), '/api/content/freshness', 'GET', env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('returns 200 with the paginated draft list scoped to the org', async () => {
    mockDbQuery.mockResolvedValue({ data: [{ id: 'd1', site_id: 's1', status: 'pending' }] });
    mockDbQueryOne.mockResolvedValue({ cnt: 1 });
    const env = makeEnv();
    const res = await req(makeApp(AUTH), '/api/content/freshness?page=2&status=pending', 'GET', env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      drafts: unknown[];
      total: number;
      page: number;
      limit: number;
    };
    expect(json.drafts).toHaveLength(1);
    expect(json.total).toBe(1);
    expect(json.page).toBe(2);
    expect(json.limit).toBe(25);
    // org_id + status + LIMIT/OFFSET all bound; page 2 → offset 25.
    const params = mockDbQuery.mock.calls[0][2] as unknown[];
    expect(params).toEqual(['org-1', 'pending', 25, 25]);
  });

  it('defaults missing total to 0 when the count row is null', async () => {
    mockDbQuery.mockResolvedValue({ data: [] });
    mockDbQueryOne.mockResolvedValue(null);
    const res = await req(makeApp(AUTH), '/api/content/freshness', 'GET', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { total: number; page: number };
    expect(json.total).toBe(0);
    expect(json.page).toBe(1);
  });

  it('returns 500 via the shared error handler when D1 throws', async () => {
    mockDbQuery.mockRejectedValue(new Error('D1 down'));
    const res = await req(makeApp(AUTH), '/api/content/freshness', 'GET', makeEnv());
    expect(res.status).toBe(500);
  });
});

// ─── GET /api/content/freshness/:draftId (detail) ──────────────────────────────

describe('GET /api/content/freshness/:draftId', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/content/freshness/d1', 'GET', makeEnv());
    expect(res.status).toBe(401);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leaking) when the draft is not in the caller org', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const res = await req(makeApp(AUTH), '/api/content/freshness/other-org-draft', 'GET', makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    // Query is org-scoped: id + org_id both bound.
    expect(mockDbQueryOne.mock.calls[0][2]).toEqual(['other-org-draft', 'org-1']);
  });

  it('returns 200 with the draft detail when found', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'd1', site_id: 's1', status: 'pending' });
    const res = await req(makeApp(AUTH), '/api/content/freshness/d1', 'GET', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { draft: { id: string } };
    expect(json.draft.id).toBe('d1');
  });
});

// ─── POST /api/content/freshness/approve/:draftId ──────────────────────────────

describe('POST /api/content/freshness/approve/:draftId', () => {
  it('returns 401 when unauthenticated and never calls the publisher', async () => {
    const res = await req(makeApp(), '/api/content/freshness/approve/d1', 'POST', makeEnv());
    expect(res.status).toBe(401);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('returns 200 and publishes when the service succeeds', async () => {
    mockPublish.mockResolvedValue({ ok: true });
    const res = await req(makeApp(AUTH), '/api/content/freshness/approve/d1', 'POST', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; draftId: string; published: boolean };
    expect(json).toMatchObject({ ok: true, draftId: 'd1', published: true });
    // org-scoped publish call: (env, draftId, userId, orgId).
    expect(mockPublish.mock.calls[0].slice(1)).toEqual(['d1', 'user-1', 'org-1']);
  });

  it('returns 400 with the service error message when publish fails', async () => {
    mockPublish.mockResolvedValue({ ok: false, error: 'Draft already published' });
    const res = await req(makeApp(AUTH), '/api/content/freshness/approve/d1', 'POST', makeEnv());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(json.error?.message).toBe('Draft already published');
  });

  it('returns 500 via the error handler when the publisher throws', async () => {
    mockPublish.mockRejectedValue(new Error('R2 write failed'));
    const res = await req(makeApp(AUTH), '/api/content/freshness/approve/d1', 'POST', makeEnv());
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/content/freshness/reject/:draftId ───────────────────────────────

describe('POST /api/content/freshness/reject/:draftId', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await req(makeApp(), '/api/content/freshness/reject/d1', 'POST', makeEnv());
    expect(res.status).toBe(401);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leaking) when the draft is not in the caller org', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const res = await req(makeApp(AUTH), '/api/content/freshness/reject/d1', 'POST', makeEnv());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when the draft is not in pending status', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'd1', status: 'published' });
    const res = await req(makeApp(AUTH), '/api/content/freshness/reject/d1', 'POST', makeEnv());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
    expect(json.error?.message).toContain('published');
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it('returns 200 and soft-rejects a pending draft', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'd1', status: 'pending' });
    const res = await req(makeApp(AUTH), '/api/content/freshness/reject/d1', 'POST', makeEnv());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; draftId: string; rejected: boolean };
    expect(json).toMatchObject({ ok: true, draftId: 'd1', rejected: true });
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    expect(mockDbUpdate.mock.calls[0][2]).toEqual({ status: 'rejected' });
  });

  it('returns 500 via the error handler when the update throws', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'd1', status: 'pending' });
    mockDbUpdate.mockRejectedValue(new Error('D1 write failed'));
    const res = await req(makeApp(AUTH), '/api/content/freshness/reject/d1', 'POST', makeEnv());
    expect(res.status).toBe(500);
  });
});

// ─── POST /api/content/freshness/trigger ───────────────────────────────────────

describe('POST /api/content/freshness/trigger', () => {
  it('returns 401 when unauthenticated and never schedules a scan', async () => {
    const ctx = makeCtx();
    const res = await req(makeApp(), '/api/content/freshness/trigger', 'POST', makeEnv(), ctx);
    expect(res.status).toBe(401);
    expect(ctx.waitUntil).not.toHaveBeenCalled();
    expect(mockScheduled).not.toHaveBeenCalled();
  });

  it('returns 200 and schedules the scan as fire-and-forget', async () => {
    const ctx = makeCtx();
    const res = await req(makeApp(AUTH), '/api/content/freshness/trigger', 'POST', makeEnv(), ctx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; message: string };
    expect(json.ok).toBe(true);
    expect(json.message).toMatch(/triggered/i);
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(mockScheduled).toHaveBeenCalledTimes(1);
  });
});
