/**
 * Voice + Billing admin sections — auth-gate + public API smoke.
 *
 * Voice: phone numbers, conversations, test console, agent prompt editor.
 * Billing: Stripe checkout, subscriptions, wallet, credit balance.
 *
 * API contract (post soft-404 guard): all three billing routes are MOUNTED
 * authed routes in src/routes/api.ts — unauthenticated calls hit
 * `if (!orgId) throw unauthorized(...)` → 401. A 404 here would mean the route
 * fell through to the /api/* soft-404 guard, i.e. an unmount regression.
 * 403 is accepted only because Cloudflare WAF may origin-challenge
 * request-context (non-browser) calls.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Voice Admin', () => {
  test('/admin/voice redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/voice`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });
});

test.describe('Billing Admin', () => {
  test('/admin/billing redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/billing`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });
});

test.describe('API Smoke', () => {
  test('GET /api/billing/subscription is mounted + auth-gated (401, never 404)', async ({
    request,
  }) => {
    const res = await request.get(`${PROD_URL}/api/billing/subscription`);
    expect([401, 403]).toContain(res.status());
  });

  test('GET /api/billing/entitlements is mounted + auth-gated (401, never 404)', async ({
    request,
  }) => {
    const res = await request.get(`${PROD_URL}/api/billing/entitlements`);
    expect([401, 403]).toContain(res.status());
  });

  test('POST /api/billing/checkout requires auth', async ({ request }) => {
    // The handler Zod-parses the body BEFORE the auth check (api.ts — checkout
    // handler: createCheckoutSessionSchema.parse precedes the orgId/userId
    // gate), so the body must satisfy the schema (success_url + cancel_url
    // required URLs, budget_tier enum — packages/shared/src/schemas/billing.ts)
    // for the request to reach — and be rejected by — the auth gate as 401.
    const res = await request.post(`${PROD_URL}/api/billing/checkout`, {
      data: {
        success_url: 'https://projectsites.dev/admin/billing',
        cancel_url: 'https://projectsites.dev/pricing',
        budget_tier: 'standard',
      },
    });
    // 401 = honest auth rejection; 403 = WAF origin-challenge on the
    // request-context POST. Never 404 (soft-404 would mean route unmounted),
    // never 200 (auth bypass), never 400 (body above is schema-valid).
    expect([401, 403]).toContain(res.status());
  });
});
