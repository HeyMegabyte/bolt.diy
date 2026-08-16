/**
 * @file auth_org_routes.test.ts
 * @description Custom-auth Team/Organization mutations (`/api/auth/organization/*`)
 * for `/admin/team` (Better Auth is dark → this custom D1 path is LIVE).
 *
 * Focus: the two `dbExecute`-backed soft-delete mutations must NOT report a lying
 * success. `dbExecute` returns `{ error, changes }` and never throws, so a handler
 * that ignores the result returns `{ status: true }` even when the UPDATE errored
 * or matched zero rows (wrong id / another org's row / already-gone / self). The
 * WHERE clause is the SOLE ownership guard, so `changes === 0` MUST surface as 404
 * (not a lying 200) and a DB error MUST surface as 500.
 */
jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbExecute: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { authOrg } from '../routes/auth_org.js';
import { dbExecute } from '../services/db.js';

const mockDbExecute = dbExecute as unknown as jest.Mock;

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: {} as D1Database } as unknown as Env;
}

function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', authOrg);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

type AnyApp = Hono<{ Bindings: Env; Variables: Variables }>;
function req(app: AnyApp, path: string, init: RequestInit, env: Env) {
  return app.request(path, init, env, makeCtx());
}
function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue({ error: null, changes: 1 });
});

describe('POST /api/auth/organization/cancel-invitation', () => {
  it('returns 401 when org context is missing', async () => {
    const res = await req(
      makeApp(),
      '/api/auth/organization/cancel-invitation',
      jsonInit('POST', { invitationId: 'inv-1' }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('returns 400 when invitationId is missing', async () => {
    const res = await req(
      makeApp(AUTH),
      '/api/auth/organization/cancel-invitation',
      jsonInit('POST', {}),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('cancels a real invite and returns 200 { status: true }', async () => {
    const res = await req(
      makeApp(AUTH),
      '/api/auth/organization/cancel-invitation',
      jsonInit('POST', { invitationId: 'inv-1' }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });

  it('returns 404 (not a lying 200) when the invite is not found / not this org', async () => {
    mockDbExecute.mockResolvedValueOnce({ error: null, changes: 0 });
    const res = await req(
      makeApp(AUTH),
      '/api/auth/organization/cancel-invitation',
      jsonInit('POST', { invitationId: 'inv-nope' }),
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('returns 500 (never a lying 200) when the UPDATE errors', async () => {
    mockDbExecute.mockResolvedValueOnce({ error: 'D1_ERROR: disk full', changes: 0 });
    const res = await req(
      makeApp(AUTH),
      '/api/auth/organization/cancel-invitation',
      jsonInit('POST', { invitationId: 'inv-1' }),
      makeEnv(),
    );
    expect(res.status).toBe(500);
  });
});

describe('POST /api/auth/organization/remove-member', () => {
  it('returns 401 when org context is missing', async () => {
    const res = await req(
      makeApp(),
      '/api/auth/organization/remove-member',
      jsonInit('POST', { memberIdOrEmail: 'mem-1' }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('returns 400 when memberIdOrEmail is missing', async () => {
    const res = await req(
      makeApp(AUTH),
      '/api/auth/organization/remove-member',
      jsonInit('POST', {}),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('removes a real member and returns 200 { status: true }', async () => {
    const res = await req(
      makeApp(AUTH),
      '/api/auth/organization/remove-member',
      jsonInit('POST', { memberIdOrEmail: 'mem-1' }),
      makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });

  it('returns 404 (not a lying 200) when nothing was removed (not found / self / other org)', async () => {
    mockDbExecute.mockResolvedValueOnce({ error: null, changes: 0 });
    const res = await req(
      makeApp(AUTH),
      '/api/auth/organization/remove-member',
      jsonInit('POST', { memberIdOrEmail: 'user-1' }),
      makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('returns 500 (never a lying 200) when the UPDATE errors', async () => {
    mockDbExecute.mockResolvedValueOnce({ error: 'D1_ERROR: disk full', changes: 0 });
    const res = await req(
      makeApp(AUTH),
      '/api/auth/organization/remove-member',
      jsonInit('POST', { memberIdOrEmail: 'mem-1' }),
      makeEnv(),
    );
    expect(res.status).toBe(500);
  });
});
