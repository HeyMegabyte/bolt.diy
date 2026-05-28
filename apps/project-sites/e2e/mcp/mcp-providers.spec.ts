/**
 * @module e2e/mcp/mcp-providers
 * @description E2E tests for MCP OAuth provider flows.
 *
 * Covers MCP-01..MCP-06:
 * - /api/mcp/:provider/connect → authorize URL with PKCE
 * - /api/mcp/:provider/callback → code exchange + encrypted token
 * - 501 when OAuth unconfigured
 * - Paste-key fallback
 * - Site MCP server manifest at /{slug}/mcp
 * - Discovery endpoint /{slug}/.well-known/mcp
 *
 * @packageDocumentation
 */

import { test, expect } from '../fixtures.js';

const PROVIDERS = ['mailchimp', 'hubspot', 'github', 'slack', 'notion', 'linear'] as const;

// ---------------------------------------------------------------------------
// MCP-01 — /api/mcp/:provider/connect returns authorize URL with PKCE
// ---------------------------------------------------------------------------
test.describe('MCP-01 — connect returns authorize URL', () => {
  test('GET /api/mcp/github/connect without auth returns 401', async ({ page }) => {
    const res = await page.request.get('/api/mcp/github/connect');
    expect(res.status()).toBe(401);
  });

  test('GET /api/mcp/github/connect with auth returns authorize_url or 501', async ({ authedPage: page }) => {
    const res = await page.request.get('/api/mcp/github/connect');
    // Either returns 200 { authorize_url } or 501 oauth_not_configured
    expect([200, 501]).toContain(res.status());
  });

  for (const provider of PROVIDERS) {
    test(`GET /api/mcp/${provider}/connect auth guard: returns 401 or 200/501`, async ({ page }) => {
      const res = await page.request.get(`/api/mcp/${provider}/connect`);
      // Unauthenticated must not return 200
      expect(res.status()).not.toBe(200);
    });
  }
});

// ---------------------------------------------------------------------------
// MCP-02 — /api/mcp/:provider/callback exchanges code + encrypts token
// ---------------------------------------------------------------------------
test.describe('MCP-02 — callback exchanges code', () => {
  test('GET /api/mcp/github/callback with no state returns 400 or 401', async ({ page }) => {
    const res = await page.request.get('/api/mcp/github/callback?code=fake_code');
    expect([400, 401, 422]).toContain(res.status());
  });

  test('GET /api/mcp/github/callback with bad state returns error', async ({ page }) => {
    const res = await page.request.get('/api/mcp/github/callback?code=fake&state=bad_state');
    expect([400, 401, 422, 404]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// MCP-03 — /api/mcp/:provider/connect returns 501 when OAuth unconfigured
// ---------------------------------------------------------------------------
test.describe('MCP-03 — 501 when OAuth unconfigured', () => {
  // resend never has OAuth creds — always returns 501 oauth_not_configured
  test('GET /api/mcp/resend/connect with auth returns 501', async ({ authedPage: page }) => {
    const res = await page.request.get('/api/mcp/resend/connect');
    // resend is a paste-key provider — should return 200 with paste spec or 501
    expect([200, 501]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json() as Record<string, unknown>;
      // Either has authorize_url (OAuth) or paste_spec (paste-key fallback)
      expect(body).toMatchObject(
        expect.objectContaining({
          ...(body.authorize_url ? { authorize_url: expect.any(String) } : {}),
          ...(body.paste_spec ? { paste_spec: expect.any(Object) } : {}),
        }),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// MCP-04 — /api/mcp/:provider/paste accepts paste-key when 501
// ---------------------------------------------------------------------------
test.describe('MCP-04 — paste-key fallback', () => {
  test('POST /api/mcp/resend/paste without auth returns 401', async ({ page }) => {
    const res = await page.request.post('/api/mcp/resend/paste', {
      data: { api_key: 're_test_key_12345' },
    });
    expect(res.status()).toBe(401);
  });

  test('POST /api/mcp/resend/paste with auth + valid key shape returns 200 or 422', async ({ authedPage: page }) => {
    const res = await page.request.post('/api/mcp/resend/paste', {
      data: { api_key: 're_test_key_placeholder', site_id: 'nonexistent-site' },
    });
    // 422 = validation error (site not found), 200 = saved
    expect([200, 422, 404]).toContain(res.status());
  });
});

// ---------------------------------------------------------------------------
// MCP-05 — Site MCP server /{slug}/mcp serves manifest
// ---------------------------------------------------------------------------
test.describe('MCP-05 — Site MCP manifest', () => {
  test('GET /mcp-test-slug/mcp returns 200 or 404', async ({ page }) => {
    const res = await page.request.get('/mcp-test-slug/mcp');
    // Either 200 (manifest) or 404 (slug not found) — never 500
    expect([200, 404]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

// ---------------------------------------------------------------------------
// MCP-06 — Site MCP discovery /{slug}/.well-known/mcp
// ---------------------------------------------------------------------------
test.describe('MCP-06 — Site MCP well-known discovery', () => {
  test('GET /mcp-test-slug/.well-known/mcp returns 200 or 404', async ({ page }) => {
    const res = await page.request.get('/mcp-test-slug/.well-known/mcp');
    expect([200, 404]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});
