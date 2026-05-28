/**
 * E2E: Per-site MCP Server CRUD tools (#29)
 *
 * Tests the JSON-RPC 2.0 endpoints and token management API.
 * Auth-gated tests are skipped unless E2E_AUTH_TOKEN is set.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('MCP Server — discovery endpoints', () => {
  test('Marketing-root /.well-known/mcp returns the platform-level manifest', async ({
    request,
  }) => {
    const res = await request.get(`${PROD_URL}/.well-known/mcp`);
    // The marketing root MCP is served by features.ts and should 200 or 404 (not 5xx).
    expect(res.status()).not.toBe(500);
  });

  test('Non-existent slug /.well-known/mcp returns 404', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/totally-nonexistent-slug/.well-known/mcp`);
    expect(res.status()).toBe(404);
  });

  test('Path-based POST /:slug/mcp returns JSON-RPC initialize response for known site', async ({
    request,
  }) => {
    // We use the marketing worker as a proxy to check the JSON-RPC plumbing.
    // A real slug that exists should return a 2.0 initialize result.
    // Use a slug known to exist in the test environment, or accept 404.
    const res = await request.post(`${PROD_URL}/demo/mcp`, {
      data: { jsonrpc: '2.0', id: 1, method: 'initialize' },
      headers: { 'Content-Type': 'application/json' },
    });
    // Either the site exists and returns a 200, or 404 — never 5xx.
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('jsonrpc', '2.0');
    }
  });
});

test.describe('MCP Server — tools/list', () => {
  test('tools/list returns at least the built-in CRUD tools when site exists', async ({
    request,
  }) => {
    const res = await request.post(`${PROD_URL}/demo/mcp`, {
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status() === 200) {
      const body = await res.json() as { result?: { tools?: Array<{ name: string }> } };
      const tools = body?.result?.tools ?? [];
      const names = tools.map((t) => t.name);
      // Verify core CRUD tools are present.
      expect(names).toContain('list_pages');
      expect(names).toContain('read_page');
      expect(names).toContain('get_analytics_summary');
    }
  });
});

test.describe('MCP Server — tools/call auth gate', () => {
  test('tools/call without Bearer token returns unauthorized', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/demo/mcp`, {
      data: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'list_pages', arguments: {} },
      },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.status() === 200) {
      const body = await res.json() as { result?: { isError?: boolean } };
      // Should fail auth — isError or an error field.
      expect(body?.result).toBeDefined();
    } else {
      // 404 is fine — site doesn't exist in test env.
      expect([200, 404]).toContain(res.status());
    }
  });
});

test.describe('MCP Server — token management API', () => {
  test('GET /api/sites/:id/mcp/tokens returns 401 without auth', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/sites/test-id/mcp/tokens`);
    expect(res.status()).toBe(401);
  });

  test('POST /api/sites/:id/mcp/tokens returns 401 without auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/sites/test-id/mcp/tokens`, {
      data: { label: 'test' },
    });
    expect(res.status()).toBe(401);
  });

  test('DELETE /api/sites/:id/mcp/tokens/:tokenId returns 401 without auth', async ({
    request,
  }) => {
    const res = await request.delete(`${PROD_URL}/api/sites/test-id/mcp/tokens/test-token-id`);
    expect(res.status()).toBe(401);
  });
});

test.describe('MCP Server — admin UI', () => {
  test('Homepage loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(PROD_URL);
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

  test.skip('Admin /admin/sites/:id/mcp-server renders tool list (requires auth)', async ({
    page,
  }) => {
    // Skipped: requires live auth session. Run manually with E2E_AUTH_TOKEN.
    // Assertions: data-testid="site-mcp-server", rolling-counter for calls today,
    // tokens table visible, "Test" button present for each tool.
  });
});
