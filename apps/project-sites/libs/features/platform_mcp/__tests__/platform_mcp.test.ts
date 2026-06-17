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
  dbInsert: jest.fn().mockResolvedValue({}),
  dbQuery: jest.fn().mockResolvedValue({ data: [] }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbExecute: jest.fn().mockResolvedValue(undefined),
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
    expect(names).toEqual(expect.arrayContaining(['whoami', 'list_sites', 'get_site', 'get_build_status', 'get_audit_log', 'deploy_site', 'create_site', 'list_snapshots', 'get_research']));
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

  it('deploy_site rejects an empty file set', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', name: 'k', scopes: '["sites:write"]' });
    const res = await rpc('tools/call', { name: 'deploy_site', arguments: { site_id: 's1', files: [] } }, { authorization: 'Bearer psk_x' });
    const body = await res.json();
    expect(body.result.isError).toBe(true);
  });

  it('deploy_site rejects a path-traversal file path (never reaches R2)', async () => {
    const { dbQueryOne } = require('../../../../src/services/db.js');
    dbQueryOne.mockClear();
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', name: 'k', scopes: '["sites:write"]' });
    const res = await rpc(
      'tools/call',
      { name: 'deploy_site', arguments: { site_id: 's1', files: [{ path: '../../other/_manifest.json', content: 'x' }] } },
      { authorization: 'Bearer psk_x' },
    );
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain('".." segments');
    // Validation fails BEFORE the ownership query — the unsafe path never hits the DB/R2.
    expect(dbQueryOne).not.toHaveBeenCalled();
  });

  it('deploy_site 404s on a site the token org does not own', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', name: 'k', scopes: '["sites:write"]' });
    const res = await rpc('tools/call', { name: 'deploy_site', arguments: { site_id: 'foreign', files: [{ path: 'index.html', content: '<h1>hi</h1>' }] } }, { authorization: 'Bearer psk_x' });
    const body = await res.json();
    expect(body.result.content[0].text).toContain('Site not found');
  });

  it('deploy_site publishes + returns a version-pinned preview_url', async () => {
    const { dbQueryOne, dbInsert, dbExecute } = require('../../../../src/services/db.js');
    dbQueryOne.mockResolvedValueOnce({ id: 's1', slug: 'acme' }); // owned site
    dbInsert.mockResolvedValueOnce({}); // snapshot insert ok
    dbExecute.mockResolvedValueOnce(undefined);
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', name: 'k', scopes: '["sites:write"]' });
    const env = {
      SITES_BUCKET: { put: jest.fn().mockResolvedValue({}) },
      CACHE_KV: { delete: jest.fn().mockResolvedValue(undefined) },
    };
    const res = await app().request(
      '/api/mcp',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer psk_x' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'deploy_site', arguments: { site_id: 's1', files: [{ path: 'index.html', content: '<h1>hi</h1>' }] } },
        }),
      },
      env as never,
      { waitUntil() {}, passThroughOnException() {} } as never,
    );
    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.live_url).toBe('https://acme.projectsites.dev');
    expect(payload.preview_url).toMatch(/^https:\/\/acme-d[0-9a-f]{8}\.projectsites\.dev$/);
    expect(env.SITES_BUCKET.put).toHaveBeenCalled();
  });

  it('create_site creates a draft + returns the slug', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', name: 'k', scopes: '["sites:write"]' });
    const res = await rpc('tools/call', { name: 'create_site', arguments: { business_name: 'Acme Co' } }, { authorization: 'Bearer psk_x' });
    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0].text).toContain('acme-co');
  });

  it('list_snapshots returns an empty snapshot list when none exist', async () => {
    const { dbQueryOne, dbQuery } = require('../../../../src/services/db.js');
    dbQueryOne.mockResolvedValueOnce({ id: 'site-1' }); // ownership check passes
    dbQuery.mockResolvedValueOnce({ data: [] });          // no snapshots
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', name: 'k', scopes: '["sites:read"]' });
    const res = await rpc('tools/call', { name: 'list_snapshots', arguments: { site_id: 'site-1' } }, { authorization: 'Bearer psk_x' });
    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.count).toBe(0);
    expect(Array.isArray(payload.snapshots)).toBe(true);
  });

  it('get_research returns deduplicated research keyed by task_name', async () => {
    const { dbQueryOne, dbQuery } = require('../../../../src/services/db.js');
    dbQueryOne.mockResolvedValueOnce({ id: 'site-1' }); // ownership check passes
    dbQuery.mockResolvedValueOnce({
      data: [
        { task_name: 'business_profile', parsed_output: '{"name":"Acme"}', raw_output: '' },
        { task_name: 'business_profile', parsed_output: '{"name":"OLD"}', raw_output: '' }, // duplicate, should be skipped
      ],
    });
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', name: 'k', scopes: '["sites:read"]' });
    const res = await rpc('tools/call', { name: 'get_research', arguments: { site_id: 'site-1' } }, { authorization: 'Bearer psk_x' });
    const body = await res.json();
    expect(body.result.isError).toBeFalsy();
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload.research['business_profile']).toEqual({ name: 'Acme' });
    expect(Object.keys(payload.research)).toHaveLength(1); // only one unique task
  });
});
