/**
 * E2E tests for the platform MCP HTTP surface at /api/mcp.
 *
 * The feature is flag-gated by `platform_mcp` (default OFF → routes return 404).
 * Tests are designed to be green in BOTH states:
 *   - Flag OFF (current prod default) → all flag-gated assertions accept 404.
 *   - Flag ON → full JSON-RPC 2.0 semantics are asserted.
 *
 * Auth-independent paths (parse error, unauthorized tool call) hold regardless
 * of the flag state when the feature IS enabled. Tests that depend on the flag
 * being ON are clearly annotated.
 *
 * Run against local dev:
 *   npx playwright test e2e/platform-mcp --config playwright.config.ts
 * Run against prod:
 *   BASE_URL=https://projectsites.dev npx playwright test e2e/platform-mcp --config playwright.config.ts
 */

import { test, expect } from '../fixtures.js';

const MCP_PATH = '/api/mcp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** POST /api/mcp with a JSON-RPC body. Returns the raw APIResponse. */
async function rpcPost(
  request: import('@playwright/test').APIRequestContext,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return request.post(MCP_PATH, {
    data: body,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * A valid minimal JSON-RPC 2.0 wrapper.
 * All methods that aren't `tools/call` are open — no auth token needed.
 */
function rpc(method: string, params?: unknown, id: number | string | null = 1) {
  const body: Record<string, unknown> = { jsonrpc: '2.0', id, method };
  if (params !== undefined) body['params'] = params;
  return body;
}

// ---------------------------------------------------------------------------
// GET /api/mcp — discovery manifest
// ---------------------------------------------------------------------------

test.describe('GET /api/mcp — discovery manifest', () => {
  test('flag OFF returns 404 without leaking secrets', async ({ request }) => {
    const res = await request.get(MCP_PATH);
    // When the feature flag is OFF the handler returns 404 (never 403 — existence is hidden).
    // When the flag is ON it returns 200 with the discovery manifest.
    // Either is acceptable; assert the invariant that no secret/token is leaked.
    const status = res.status();
    expect([200, 404]).toContain(status);

    const text = await res.text();

    // Must never leak internal secrets regardless of status.
    expect(text).not.toMatch(/psk_live_/);
    expect(text).not.toMatch(/CLOUDFLARE_API/i);
    expect(text).not.toMatch(/SECRET/);
    expect(text).not.toMatch(/password/i);
  });

  test('flag ON returns manifest with required discovery fields', async ({ request }) => {
    const res = await request.get(MCP_PATH);
    const status = res.status();

    if (status === 404) {
      // Flag is OFF — confirm the 404 body is structured JSON, not an HTML crash page.
      const body = await res.json().catch(() => null);
      if (body !== null) {
        expect(typeof body).toBe('object');
      }
      return; // flag off — nothing to verify about manifest shape
    }

    // Flag ON path.
    expect(status).toBe(200);
    const body = await res.json();

    expect(body).toHaveProperty('server');
    expect(body.server).toHaveProperty('name', 'projectsites.dev');
    expect(body.server).toHaveProperty('version');

    expect(body).toHaveProperty('protocolVersion', '2025-11-25');
    expect(body).toHaveProperty('endpoint', '/api/mcp');

    expect(body).toHaveProperty('auth');
    expect(body.auth).toHaveProperty('type', 'bearer');

    expect(body).toHaveProperty('tools');
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);
    for (const tool of body.tools as Array<{ name?: unknown; description?: unknown }>) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/mcp — initialize
// ---------------------------------------------------------------------------

test.describe("POST /api/mcp — method 'initialize'", () => {
  test('returns serverInfo + protocolVersion when flag ON, or 404 when OFF', async ({ request }) => {
    const res = await rpcPost(request, rpc('initialize'));
    const status = res.status();

    // Flag OFF: 404. Flag on: 200.
    expect([200, 404]).toContain(status);

    if (status === 404) {
      // Acceptable — feature is dark-launched.
      return;
    }

    // Flag ON path.
    const body = await res.json();
    expect(body).toHaveProperty('jsonrpc', '2.0');
    expect(body).toHaveProperty('id', 1);
    expect(body).toHaveProperty('result');

    const result = body.result as Record<string, unknown>;
    expect(result).toHaveProperty('protocolVersion', '2025-11-25');
    expect(result).toHaveProperty('serverInfo');
    const serverInfo = result['serverInfo'] as Record<string, unknown>;
    expect(serverInfo['name']).toBe('projectsites.dev');
    expect(result).toHaveProperty('capabilities');
  });
});

// ---------------------------------------------------------------------------
// POST /api/mcp — tools/list
// ---------------------------------------------------------------------------

test.describe("POST /api/mcp — method 'tools/list'", () => {
  test('returns tools array with name + description + inputSchema when flag ON', async ({ request }) => {
    const res = await rpcPost(request, rpc('tools/list'));
    const status = res.status();

    expect([200, 404]).toContain(status);
    if (status === 404) return;

    const body = await res.json();
    expect(body).toHaveProperty('jsonrpc', '2.0');
    expect(body).toHaveProperty('result');

    const result = body.result as { tools?: unknown[] };
    expect(Array.isArray(result.tools)).toBe(true);
    expect((result.tools as unknown[]).length).toBeGreaterThan(0);

    // Every tool must have name + description + inputSchema.
    for (const tool of result.tools as Array<Record<string, unknown>>) {
      expect(typeof tool['name']).toBe('string');
      expect(typeof tool['description']).toBe('string');
      expect(tool).toHaveProperty('inputSchema');
      expect(typeof tool['inputSchema']).toBe('object');
    }
  });

  test('whoami tool is listed when flag ON', async ({ request }) => {
    const res = await rpcPost(request, rpc('tools/list'));
    if (res.status() === 404) return; // flag off

    const body = await res.json();
    const tools = (body.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain('whoami');
  });
});

// ---------------------------------------------------------------------------
// POST /api/mcp — tools/call WITHOUT auth (must return -32001 unauthorized)
// ---------------------------------------------------------------------------

test.describe("POST /api/mcp — tools/call unauthorized", () => {
  test('no Authorization header returns JSON-RPC error -32001, never data', async ({
    request,
  }) => {
    const res = await rpcPost(request, rpc('tools/call', { name: 'whoami' }));
    const status = res.status();

    // Flag off → 404. Flag on → 401 with WWW-Authenticate (RFC 9728) so OAuth-capable
    // clients auto-discover the authorization server; the JSON-RPC -32001 is in `result`.
    expect([401, 404]).toContain(status);
    if (status === 404) return; // flag off — cannot test auth enforcement

    expect(status).toBe(401);
    expect(res.headers()['www-authenticate'] ?? '').toContain('resource_metadata=');
    const body = await res.json();
    expect(body).toHaveProperty('jsonrpc', '2.0');

    const error = body.result as { code?: unknown; message?: unknown };
    // -32001 is the unauthorized code defined in handlers.ts.
    expect(error.code).toBe(-32001);
    expect(typeof error.message).toBe('string');
    expect(error.message).toMatch(/unauthorized/i);
  });

  test('fake token returns unauthorized, no data leak', async ({ request }) => {
    const res = await rpcPost(
      request,
      rpc('tools/call', { name: 'whoami' }),
      { Authorization: 'Bearer psk_fake_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    );
    const status = res.status();

    expect([401, 404]).toContain(status);
    if (status === 404) return;

    const body = await res.json();

    // The bad token is unauthorized — there must be NO org_id, site data, or
    // internal error details in the response.
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/"org_id"/);
    expect(text).not.toMatch(/"scopes"\s*:\s*\[/);

    expect(body).toHaveProperty('result');
  });
});

// ---------------------------------------------------------------------------
// POST /api/mcp — malformed JSON → -32700 parse error
// ---------------------------------------------------------------------------

test.describe('POST /api/mcp — malformed JSON body', () => {
  test('non-JSON body returns HTTP 4xx with -32700 parse error code', async ({ request }) => {
    const res = await request.post(MCP_PATH, {
      data: '{ this is not json !!!',
      headers: { 'Content-Type': 'application/json' },
    });
    const status = res.status();

    // Flag OFF → 404.
    // Flag ON + bad JSON → 400 with parse error.
    expect([400, 404]).toContain(status);
    if (status === 404) return;

    const body = await res.json();
    expect(body).toHaveProperty('error');
    const error = body.error as { code?: unknown };
    expect(error.code).toBe(-32700);
  });

  test('empty body returns parse or invalid-request error', async ({ request }) => {
    const res = await request.post(MCP_PATH, {
      data: '',
      headers: { 'Content-Type': 'application/json' },
    });
    const status = res.status();
    expect([400, 404]).toContain(status);
    if (status === 404) return;

    const body = await res.json();
    expect(body).toHaveProperty('error');
    const error = body.error as { code?: unknown };
    // -32700 parse or -32600 invalid request are both acceptable.
    expect([-32700, -32600]).toContain(error.code);
  });
});

// ---------------------------------------------------------------------------
// POST /api/mcp — unknown method → -32601
// ---------------------------------------------------------------------------

test.describe('POST /api/mcp — unknown method', () => {
  test('unknown method returns -32601 method not found', async ({ request }) => {
    const res = await rpcPost(request, rpc('totally/unknown/method'));
    const status = res.status();

    expect([200, 404]).toContain(status);
    if (status === 404) return;

    const body = await res.json();
    expect(body).toHaveProperty('jsonrpc', '2.0');
    expect(body).toHaveProperty('error');
    const error = body.error as { code?: unknown; message?: unknown };
    expect(error.code).toBe(-32601);
    expect(typeof error.message).toBe('string');
  });

  test('invalid JSON-RPC envelope (missing method) returns -32600 invalid request', async ({
    request,
  }) => {
    const res = await rpcPost(request, { jsonrpc: '2.0', id: 2 }); // no 'method'
    const status = res.status();

    expect([400, 404]).toContain(status);
    if (status === 404) return;

    const body = await res.json();
    expect(body).toHaveProperty('error');
    const error = body.error as { code?: unknown };
    expect([-32600, -32700]).toContain(error.code);
  });
});

// ---------------------------------------------------------------------------
// Security invariants — hold regardless of flag state
// ---------------------------------------------------------------------------

test.describe('Security invariants', () => {
  test('GET /api/mcp never returns stack traces or internal paths', async ({ request }) => {
    const res = await request.get(MCP_PATH);
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\w+\s+\(/); // stack-trace frames
    expect(text).not.toMatch(/\/apps\/project-sites\//); // internal file paths
    expect(text).not.toMatch(/wrangler\.toml/i);
  });

  test('POST /api/mcp parse error never returns stack traces', async ({ request }) => {
    const res = await request.post(MCP_PATH, {
      data: 'not json',
      headers: { 'Content-Type': 'application/json' },
    });
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\w+\s+\(/);
    expect(text).not.toMatch(/\/apps\/project-sites\//);
  });

  test('all /api/mcp responses have application/json Content-Type', async ({
    request,
  }) => {
    const getRes = await request.get(MCP_PATH);
    expect(getRes.headers()['content-type']).toMatch(/application\/json/);

    const postRes = await rpcPost(request, rpc('initialize'));
    expect(postRes.headers()['content-type']).toMatch(/application\/json/);
  });
});
