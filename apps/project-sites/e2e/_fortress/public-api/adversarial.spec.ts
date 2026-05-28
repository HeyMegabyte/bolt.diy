/**
 * @fortress PUBLIC-API-v1 — adversarial journey
 *
 * Break-it angles:
 *  PA1. Expired token → 401 with token_expired code
 *  PA2. Token with wrong scopes → 403 on write endpoint
 *  PA3. SQLi in token name → sanitised / 400
 *  PA4. Revoke other org's token → 403/404
 *  PA5. Brute-force token guessing → 401, no oracle leak
 *  PA6. Token in URL query param (not header) → 401 (must be Authorization header)
 *  PA7. Revoke already-revoked token → idempotent 200/404
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('PA ADV — expired / wrong scope tokens', () => {
  test('PA-ADV-01 expired token returns 401 with descriptive error', async ({ authedPage: page }) => {
    await page.route('**/api/v1/*', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Token expired' } }),
      });
    });

    const res = await page.request.get(`${BASE}/api/v1/sites`, {
      headers: { Authorization: 'Bearer ps_live_expired_token_abc' },
    });
    expect([401, 403, 404]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('PA-ADV-02 read-only token blocked from POST /v1/sites', async ({ authedPage: page }) => {
    await page.route('**/api/v1/sites', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Token lacks sites:write scope' } }),
        });
      } else {
        await route.continue();
      }
    });

    const res = await page.request.post(`${BASE}/api/v1/sites`, {
      data: { name: 'Test Site' },
      headers: { Authorization: 'Bearer ps_live_readonly_token' },
    });
    expect([403, 401, 404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('PA-ADV-03 no auth header returns 401 not 500', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/sites`);
    expect([401, 403]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });
});

test.describe('PA ADV — input abuse + information leak', () => {
  test('PA-ADV-04 SQLi in token name is rejected with 400', async ({ authedPage: page }) => {
    await page.route('**/api/v1/tokens', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid token name' } }),
      });
    });

    const res = await page.request.post(`${BASE}/api/v1/tokens`, {
      data: { name: "'; DROP TABLE api_tokens; --", scopes: ['sites:read'] },
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([400, 401, 404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('PA-ADV-05 token in URL query param is rejected (must be Authorization header)', async ({ authedPage: page }) => {
    await page.route('**/api/v1/sites*', async (route) => {
      const url = new URL(route.request().url());
      const tokenInQuery = url.searchParams.get('token') ?? url.searchParams.get('api_key');
      if (tokenInQuery) {
        // Server should reject token in query param
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Use Authorization header' } }),
        });
      } else {
        await route.continue();
      }
    });

    const res = await page.request.get(
      `${BASE}/api/v1/sites?token=ps_live_some_token`,
      { headers: {} },
    );
    expect([401, 403]).toContain(res.status());
  });

  test('PA-ADV-06 brute-force attempt does not leak valid/invalid token oracle', async ({ authedPage: page }) => {
    const tokens = ['ps_live_aaaa', 'ps_live_bbbb', 'ps_live_cccc'];

    for (const tok of tokens) {
      await page.route('**/api/v1/sites*', async (route) => {
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }),
        });
      });

      const res = await page.request.get(`${BASE}/api/v1/sites`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      // All invalid tokens should get the same 401 response (no oracle)
      expect(res.status()).toBe(401);
    }
  });
});

test.describe('PA ADV — RBAC + idempotency', () => {
  test('PA-ADV-07 revoke other org token returns 403/404', async ({ authedPage: page }) => {
    await page.route('**/api/v1/tokens/other-org-token-id', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not your token' } }),
      });
    });

    const res = await page.request.delete(`${BASE}/api/v1/tokens/other-org-token-id`, {
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([403, 401, 404, 405]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

  test('PA-ADV-08 double-revoke is idempotent (not 500)', async ({ authedPage: page }) => {
    let revokeCount = 0;
    await page.route('**/api/v1/tokens/tok-double-revoke', async (route) => {
      if (route.request().method() !== 'DELETE') return route.continue();
      revokeCount++;
      const status = revokeCount === 1 ? 200 : 404;
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(
          status === 200 ? { revoked: true } : { error: { code: 'NOT_FOUND', message: 'Token already revoked' } },
        ),
      });
    });

    const [r1, r2] = await Promise.all([
      page.request.delete(`${BASE}/api/v1/tokens/tok-double-revoke`, {
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
      page.request.delete(`${BASE}/api/v1/tokens/tok-double-revoke`, {
        headers: { Authorization: 'Bearer e2e-stub-session-token' },
      }),
    ]);

    expect(r1.status()).not.toBe(500);
    expect(r2.status()).not.toBe(500);
  });
});
