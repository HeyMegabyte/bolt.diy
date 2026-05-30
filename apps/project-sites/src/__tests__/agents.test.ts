/**
 * @module __tests__/agents
 * @description Route-layer tests for the background-AI-agents module. Focus: the
 * `assertSiteOwnership` + `loadAgent` gates now return **404 (never 403)** for a
 * site/agent the caller's org doesn't own. `loadAgent` previously leaked an
 * existence oracle — a missing agent 404'd but a FOREIGN-org agent 403'd, so a
 * prober could tell "exists but not yours" from "doesn't exist". Both now 404.
 *
 * `pro.js` is mocked to a pass-through so these exercise the OWNERSHIP gate, not
 * the billing gate (covered elsewhere).
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
import { agents } from '../routes/agents.js';
import { errorHandler } from '../middleware/error_handler.js';
import type { Env, Variables } from '../types/env.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

const baseDb = () =>
  ({
    prepare: () => ({ bind: () => ({ run: async () => ({ meta: {} }) }) }),
  }) as unknown as Env['DB'];

/** App with auth context + real error handler + a `request` helper passing execCtx as arg 4. */
function app(ids?: { userId?: string; orgId?: string }, db: unknown = baseDb()) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    if (ids?.userId) c.set('userId', ids.userId);
    if (ids?.orgId) c.set('orgId', ids.orgId);
    c.set('requestId', 'test-req');
    await next();
  });
  a.onError(errorHandler);
  a.route('/', agents);
  const env = { DB: db } as unknown as Env;
  const ctx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const request = (path: string, init?: RequestInit) => a.request(path, init, env, ctx);
  return { request };
}

const json = { 'content-type': 'application/json' };
const OWNED_AGENT = {
  id: 'ag1',
  org_id: 'org-a',
  site_id: 'site1',
  system_prompt: 'p',
  model: 'm',
  tools_json: '[]',
  status: 'active',
  monthly_budget_cents: 1000,
  spend_this_month_cents: 0,
  max_cost_cents_per_run: 50,
};

beforeEach(() => {
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
  mockUpdate.mockResolvedValue({ error: null, changes: 1 });
});

// ─── Site-scoped routes (assertSiteOwnership → 404 never 403) ─────────
describe('GET/POST /api/sites/:siteId/agents (tenant isolation)', () => {
  it('401 when unauthenticated', async () => {
    const { request } = app();
    expect((await request('/api/sites/site1/agents')).status).toBe(401);
  });

  it('404 (NOT 403) listing for a foreign-org site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never); // assertSiteOwnership
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/sites/site1/agents');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(mockQuery).not.toHaveBeenCalled(); // never lists a foreign site's agents
  });

  it('404 for a non-existent site', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/sites/site1/agents')).status).toBe(404);
  });

  it('200 lists agents for an org-owned site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never); // owned
    mockQuery.mockResolvedValueOnce({ data: [{ id: 'ag1', name: 'Freshness bot' }], error: null });
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/sites/site1/agents');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { agents: unknown[] }).agents).toHaveLength(1);
  });

  it('404 creating on a foreign site (no insert)', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const body = JSON.stringify({
      slug: 'fresh-bot',
      name: 'Freshness',
      system_prompt: 'Keep the site content fresh and accurate.',
    });
    const res = await request('/api/sites/site1/agents', { method: 'POST', headers: json, body });
    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('201 creating on an org-owned site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const body = JSON.stringify({
      slug: 'fresh-bot',
      name: 'Freshness',
      system_prompt: 'Keep the site content fresh and accurate.',
    });
    const res = await request('/api/sites/site1/agents', { method: 'POST', headers: json, body });
    expect(res.status).toBe(201);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('400 on an invalid create body (slug too short)', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const body = JSON.stringify({ slug: 'ab', name: 'X', system_prompt: 'short' });
    const res = await request('/api/sites/site1/agents', { method: 'POST', headers: json, body });
    expect(res.status).toBe(400);
  });
});

// ─── Agent-scoped routes (loadAgent → 404 for missing AND foreign) ────
describe('agent-scoped routes (loadAgent existence-oracle closed)', () => {
  it('GET runs → 401 when unauthenticated', async () => {
    const { request } = app();
    expect((await request('/api/agents/ag1/runs')).status).toBe(401);
  });

  it('GET runs → 404 for a missing agent', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // loadAgent → no row
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/agents/ag1/runs')).status).toBe(404);
  });

  it('GET runs → 404 (NOT 403) for a FOREIGN-org agent — the closed oracle', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...OWNED_AGENT, org_id: 'OTHER_ORG' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/agents/ag1/runs');
    expect(res.status).toBe(404); // identical to the missing-agent case → no existence leak
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('GET runs → 200 for an owned agent', async () => {
    mockQueryOne.mockResolvedValueOnce(OWNED_AGENT as never);
    mockQuery.mockResolvedValueOnce({ data: [{ id: 'r1', status: 'completed' }], error: null });
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/agents/ag1/runs');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { runs: unknown[] }).runs).toHaveLength(1);
  });

  it('PATCH → 404 for a foreign-org agent (no update)', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...OWNED_AGENT, org_id: 'OTHER_ORG' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/agents/ag1', {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ status: 'paused' }),
    });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('DELETE → 404 for a missing agent (no update)', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/agents/ag1', { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('POST run → 409 when the owned agent is paused', async () => {
    mockQueryOne.mockResolvedValueOnce({ ...OWNED_AGENT, status: 'paused' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/agents/ag1/run', { method: 'POST' });
    expect(res.status).toBe(409);
  });

  it('POST run → 402 when the owned agent is over budget', async () => {
    mockQueryOne.mockResolvedValueOnce({
      ...OWNED_AGENT,
      spend_this_month_cents: 1000,
      monthly_budget_cents: 1000,
    } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/agents/ag1/run', { method: 'POST' });
    expect(res.status).toBe(402);
  });
});
