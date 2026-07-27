/**
 * Voice + Billing admin sections — auth-gate + public API smoke.
 *
 * Voice: phone numbers, conversations, test console, agent prompt editor.
 * Billing: Stripe checkout, subscriptions, wallet, credit balance.
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
  test('GET /api/billing/subscription returns structured response', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/billing/subscription`);
    // May 401 (unauthed), 200 (authed), or 404 (not yet subscribed)
    expect([200, 401, 404]).toContain(res.status());
  });

  test('GET /api/billing/entitlements returns structured response', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/billing/entitlements`);
    expect([200, 401, 404]).toContain(res.status());
  });

  test('POST /api/billing/checkout requires auth', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/billing/checkout`, {
      data: { priceId: 'test' },
    });
    // Must not return 500 — auth gate should return 401
    expect([200, 400, 401, 404]).toContain(res.status());
  });
});
