/**
 * Tests for the platform MCP server. Mocks the flag gate + api_tokens + db so
 * no network/DB. Covers: flag-off 404, initialize, tools/list (catalog),
 * tools/call unauthorized (no token), tools/call whoami (authed).
 */
import { Hono } from 'hono';

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockVerify = jest.fn();
jest.mock('../../../../src/services/api_tokens.js', () => ({
  verifyApiToken: (...a: unknown[]) => mockVerify(...a),
  extractBearerToken: (h: string | null) => (h ? h.replace(/^Bearer\s+/i, '') : null),
  hasScope: () => true,
}));

jest.mock('../../../../src/services/db.js', () => ({
  dbInsert: jest.fn().mockResolvedValue(undefined),
  dbQuery: jest.fn().mockResolvedValue({ data: [] }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
}));

import { platformMcp } from '../handlers.js';

function app() {
  const a = new Hono();
  a.route('/', platformMcp);
  return a;
}
const rpc = (method: string, params?: unknown, headers: Record<string, string> = {}) =>
  app().request('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }, {} as never, { waitUntil() {}, passThroughOnException() {} } as never);

beforeEach(() => {
  mockIsFlagOn.mockReset();
  mockVerify.mockReset();
});

describe('platform_mcp JSON-RPC', () => {
  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await rpc('initialize');
    expect(res.status).toBe(404);
  });

  it('initialize advertises the protocol + server', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await rpc('initialize');
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe('projectsites.dev');
    expect(body.result.protocolVersion).toBeTruthy();
  });

  it('tools/list returns the read catalog', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await rpc('tools/list');
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['whoami', 'list_sites', 'get_site', 'get_build_status', 'get_audit_log']));
  });

  it('tools/call without a token is unauthorized (-32001)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue(null);
    const res = await rpc('tools/call', { name: 'whoami', arguments: {} });
    const body = await res.json();
    expect(body.result.code).toBe(-32001);
  });

  it('tools/call whoami returns the org identity for a valid token', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', name: 'CI key', scopes: '["sites:read"]' });
    const res = await rpc('tools/call', { name: 'whoami', arguments: {} }, { authorization: 'Bearer psk_abc' });
    const body = await res.json();
    expect(body.result.content[0].text).toContain('org-1');
    expect(body.result.isError).toBeFalsy();
  });
});
