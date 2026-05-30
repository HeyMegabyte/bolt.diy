/**
 * @module __tests__/mcp_site
 * @description Route-layer tests for the MCP-per-site module. Focus: the
 * `assertSiteOwnership` gate on every `/api/sites/:siteId/mcp/*` admin route
 * now returns **404 (never 403)** for a site the caller's org doesn't own — a
 * 403 would confirm the site exists to a probing caller. Also covers the public
 * discovery/JSON-RPC endpoints' 404-on-unknown-slug behaviour.
 *
 * `mcp_site_tools` is mocked so these tests exercise the ownership/JSON-RPC
 * plumbing, not the tool implementations.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/mcp_site_tools.js', () => ({
  SITE_MCP_TOOLS: [],
  dispatchTool: jest.fn().mockResolvedValue({ ok: true }),
  mintSiteMcpToken: jest.fn().mockResolvedValue({ token: 'raw-token', id: 'tok1' }),
  verifySiteMcpToken: jest.fn().mockResolvedValue(false),
  revokeSiteMcpToken: jest.fn().mockResolvedValue(undefined),
}));

import { Hono } from 'hono';
import { dbQuery, dbQueryOne } from '../services/db.js';
import { mcpSite } from '../routes/mcp_site.js';
import { errorHandler } from '../middleware/error_handler.js';
import type { Env, Variables } from '../types/env.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;

/** Minimal D1 double — admin routes use the db.js helpers (mocked); raw prepare for waitUntil logging. */
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
  a.route('/', mcpSite);
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
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
});

// ─── Admin ownership gate (the 403→404 fix) ──────────────────────────
describe('admin MCP routes — tenant isolation (404 never 403)', () => {
  const adminRoutes: Array<{ method: string; path: string; body?: string }> = [
    { method: 'GET', path: '/api/sites/site1/mcp/tools' },
    {
      method: 'POST',
      path: '/api/sites/site1/mcp/tools',
      body: JSON.stringify({ tool_name: 'book', enabled: true }),
    },
    { method: 'GET', path: '/api/sites/site1/mcp/calls' },
    { method: 'GET', path: '/api/sites/site1/mcp/tokens' },
    { method: 'GET', path: '/api/sites/site1/mcp/tool-usage' },
  ];

  for (const r of adminRoutes) {
    it(`${r.method} ${r.path} → 401 when unauthenticated`, async () => {
      const { request } = app();
      const init = r.body
        ? { method: r.method, headers: json, body: r.body }
        : { method: r.method };
      expect((await request(r.path, init)).status).toBe(401);
    });

    it(`${r.method} ${r.path} → 404 (NOT 403) for a foreign-org site`, async () => {
      mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never); // assertSiteOwnership
      const { request } = app({ userId: 'u', orgId: 'org-a' });
      const init = r.body
        ? { method: r.method, headers: json, body: r.body }
        : { method: r.method };
      const res = await request(r.path, init);
      expect(res.status).toBe(404);
      const out = (await res.json()) as { error: { code: string } };
      expect(out.error.code).toBe('NOT_FOUND'); // never FORBIDDEN — don't leak existence
    });
  }

  it('GET tools → 404 for a non-existent site', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // no site row
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request('/api/sites/site1/mcp/tools')).status).toBe(404);
  });

  it('GET tools → 200 for an org-owned site', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never); // owned
    mockQuery.mockResolvedValueOnce({ data: [{ id: 't1', tool_name: 'book' }], error: null });
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/sites/site1/mcp/tools');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tools: unknown[] }).tools).toHaveLength(1);
  });

  it('POST tools → 400 on an invalid body (still gated owned first)', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'org-a' } as never);
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request('/api/sites/site1/mcp/tools', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ tool_name: 'x' }), // missing `enabled`
    });
    expect(res.status).toBe(400);
  });
});

// ─── Public discovery endpoints (404 on unknown slug) ────────────────
describe('public MCP discovery (path form)', () => {
  it('PRM doc → 404 for an unknown slug', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // resolvePublicSite → null
    const { request } = app();
    expect((await request('/ghost/.well-known/oauth-protected-resource')).status).toBe(404);
  });

  it('PRM doc → 200 for a known slug', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 's1', slug: 'vitos', org_id: 'org-a' } as never);
    const { request } = app();
    const res = await request('/vitos/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    const out = (await res.json()) as { authorization_servers: string[] };
    expect(out.authorization_servers).toContain('https://auth.projectsites.dev');
  });
});

// ─── Public JSON-RPC endpoint ────────────────────────────────────────
describe('public MCP JSON-RPC (path form)', () => {
  it('POST /:slug/mcp → 404 for an unknown slug', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // site not found
    const { request } = app();
    const res = await request('/ghost/mcp', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(404);
  });

  it('initialize → returns protocolVersion for a known slug', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 's1', slug: 'vitos', org_id: 'org-a' } as never);
    const { request } = app();
    const res = await request('/vitos/mcp', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { result: { protocolVersion: string } };
    expect(out.result.protocolVersion).toBe('2025-11-25');
  });

  it('tools/call without a Bearer token → JSON-RPC unauthorized (-32001)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 's1', slug: 'vitos', org_id: 'org-a' } as never);
    const { request } = app();
    const res = await request('/vitos/mcp', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'book' },
      }),
    });
    expect(res.status).toBe(200); // JSON-RPC errors ride a 200 envelope
    const out = (await res.json()) as { result: { code?: number } };
    expect(out.result.code).toBe(-32001);
  });

  it('invalid jsonrpc version → -32600 invalid request (400)', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 's1', slug: 'vitos', org_id: 'org-a' } as never);
    const { request } = app();
    const res = await request('/vitos/mcp', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ jsonrpc: '1.0', id: 3, method: 'initialize' }),
    });
    expect(res.status).toBe(400);
  });
});
