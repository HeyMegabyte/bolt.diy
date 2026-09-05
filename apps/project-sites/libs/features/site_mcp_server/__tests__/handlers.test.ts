import { Hono } from 'hono';

import { siteMcpServer } from '../handlers.js';
import {
  mintSiteMcpToken,
  revokeSiteMcpToken,
} from '../../../../src/services/mcp_site_tools.js';
import { writeAuditLog } from '../../../../src/services/audit.js';

/**
 * Route contract for the per-site MCP server admin surface (#29 wiring). The
 * service cores (mintSiteMcpToken / revokeSiteMcpToken / SITE_MCP_TOOLS) + the
 * D1 tables already existed and are unit-proven separately; these lock the
 * ROUTE's own guards — auth-required (401), site-ownership IDOR guard (404 not
 * 403), and the mint/list/revoke/tools/usage wiring on the happy path — because
 * before this module every one of these endpoints 404'd (the Site MCP Server
 * section rendered "Couldn't load tokens/tools"). The service mint/revoke +
 * audit writer are mocked; SITE_MCP_TOOLS runs for real (requireActual).
 */
jest.mock('../../../../src/services/mcp_site_tools.js', () => ({
  ...jest.requireActual('../../../../src/services/mcp_site_tools.js'),
  mintSiteMcpToken: jest.fn(),
  revokeSiteMcpToken: jest.fn(),
}));
jest.mock('../../../../src/services/audit.js', () => ({ writeAuditLog: jest.fn() }));

const mockMint = mintSiteMcpToken as jest.MockedFunction<typeof mintSiteMcpToken>;
const mockRevoke = revokeSiteMcpToken as jest.MockedFunction<typeof revokeSiteMcpToken>;
const mockAudit = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

/** DB mock: `.first()` feeds siteOwned (site row or null → 404); `.all()` feeds the list queries. */
function makeDb(opts: { site?: unknown; rows?: unknown[] } = {}) {
  const bind = jest.fn().mockReturnValue({
    first: jest.fn().mockResolvedValue('site' in opts ? opts.site : { slug: 's', business_name: 'B' }),
    all: jest.fn().mockResolvedValue({ results: opts.rows ?? [] }),
  });
  return { prepare: jest.fn().mockReturnValue({ bind }) };
}

/** Mount the module behind a middleware that injects the authed-session vars. */
function makeApp(auth: { userId?: string; orgId?: string }, db: unknown) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('requestId', 'req-test');
    if (auth.userId) c.set('userId', auth.userId);
    if (auth.orgId) c.set('orgId', auth.orgId);
    (c.env as { DB: unknown }).DB = db;
    await next();
  });
  app.route('/', siteMcpServer);
  return app;
}

const EXEC = { waitUntil: () => {}, passThroughOnException: () => {} };
const AUTH = { userId: 'u1', orgId: 'org1' };
const SITE = 'site1';

function req(app: Hono, path: string, init?: RequestInit) {
  return app.request(path, init, { DB: {} } as never, EXEC as never);
}

beforeEach(() => {
  mockMint.mockReset();
  mockRevoke.mockReset();
  mockAudit.mockReset().mockResolvedValue(undefined);
});

describe('site_mcp_server routes — auth + IDOR guards', () => {
  it('401 when unauthenticated (no orgId/userId)', async () => {
    const res = await req(makeApp({}, makeDb()), `/api/sites/${SITE}/mcp/tokens`);
    expect(res.status).toBe(401);
  });

  it('404 when the site is not owned by the caller org (never 403 — no leak)', async () => {
    const res = await req(makeApp(AUTH, makeDb({ site: null })), `/api/sites/${SITE}/mcp/tokens`);
    expect(res.status).toBe(404);
  });
});

describe('site_mcp_server routes — happy paths', () => {
  it('GET /mcp/tokens → { tokens: [...] } (never the hash/raw)', async () => {
    const rows = [{ id: 't1', label: 'CI', last_used: null, created_at: '2026-09-05' }];
    const res = await req(makeApp(AUTH, makeDb({ rows })), `/api/sites/${SITE}/mcp/tokens`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tokens: unknown[] };
    expect(body.tokens).toEqual(rows);
    expect(JSON.stringify(body)).not.toMatch(/token_hash/);
  });

  it('GET /mcp/tools → the real static tool registry', async () => {
    const res = await req(makeApp(AUTH, makeDb()), `/api/sites/${SITE}/mcp/tools`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tools: { name: string }[] };
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
    expect(body.tools.map((t) => t.name)).toContain('list_pages');
  });

  it('GET /mcp/tool-usage → { usage: [...] } (honest empty when none)', async () => {
    const res = await req(makeApp(AUTH, makeDb({ rows: [] })), `/api/sites/${SITE}/mcp/tool-usage`);
    expect(res.status).toBe(200);
    expect((await res.json()) as { usage: unknown[] }).toEqual({ usage: [] });
  });

  it('POST /mcp/tokens mints, returns the one-time raw token, and audit-logs', async () => {
    mockMint.mockResolvedValue({ id: 'tok9', token: 'ps_mcp_deadbeef' });
    const res = await req(makeApp(AUTH, makeDb()), `/api/sites/${SITE}/mcp/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'CI' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'tok9', token: 'ps_mcp_deadbeef' });
    expect(mockMint).toHaveBeenCalledWith(expect.anything(), SITE, 'u1', 'CI');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'mcp.token_minted', target_id: 'tok9' }),
    );
  });

  it('POST /mcp/tokens falls back to the Default label on a malformed body', async () => {
    mockMint.mockResolvedValue({ id: 't', token: 'x' });
    await req(makeApp(AUTH, makeDb()), `/api/sites/${SITE}/mcp/tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(mockMint).toHaveBeenCalledWith(expect.anything(), SITE, 'u1', 'Default');
  });

  it('DELETE /mcp/tokens/:id revokes + audit-logs', async () => {
    mockRevoke.mockResolvedValue(undefined);
    const res = await req(makeApp(AUTH, makeDb()), `/api/sites/${SITE}/mcp/tokens/tok9`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockRevoke).toHaveBeenCalledWith(expect.anything(), 'tok9', SITE);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'mcp.token_revoked' }),
    );
  });
});
