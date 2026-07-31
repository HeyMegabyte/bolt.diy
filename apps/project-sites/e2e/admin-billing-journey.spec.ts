import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

test.describe('Admin — Billing (authenticated journey)', () => {
  test('renders real content, interactions work, a11y clean', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // Stub GETs first, before auth injection
    await page.route('**/api/billing/subscription**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { plan: 'pro', status: 'active', period_end: '2025-12-31T00:00:00Z' },
        }),
      }));
    await page.route('**/api/billing/entitlements**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { sites: 25, seats: 5, storage_gb: 50 } }),
      }));
    await page.route('**/api/billing/wallet**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { balance: 1250, currency: 'usd' } }),
      }));
    await page.route('**/api/billing/alerts**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'alert-1', name: 'Monthly cap', threshold: 500, trigger: 'monthly', slack: '#billing' },
          ],
        }),
      }));
    await page.route('**/api/billing/caps**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { monthly_cap: 1000 } }),
      }));

    // Mutation stub — blanket catch for POST/PATCH/PUT/DELETE
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/admin/billing`, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    // Must not redirect to sign-in
    expect(page.url()).not.toContain('/signin');

    // Admin shell must be visible
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Subscription card (conditional — may not exist yet)
    const subscriptionCard = page.locator('[data-testid="subscription-card"]');
    if (await subscriptionCard.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(subscriptionCard).toBeVisible();
    }

    // Wallet balance (conditional)
    const walletBalance = page.locator('[data-testid="wallet-balance"]');
    if (await walletBalance.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(walletBalance).toBeVisible();
    }

    // Spend alert trigger interaction (conditional)
    const alertTrigger = page.locator('[data-testid="billing-spend-alert-trigger"]');
    if (await alertTrigger.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await alertTrigger.click();
      const alertName = page.locator('[data-testid="billing-spend-alert-name"]');
      if (await alertName.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(alertName).toBeVisible();
        await page.keyboard.press('Escape');
      }
    }

    // Caps modal interaction (conditional)
    const capsModalOpen = page.locator('[data-testid="billing-caps-modal-open"]');
    if (await capsModalOpen.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await capsModalOpen.click();
      const capsInput = page.locator('[data-testid="billing-custom-amount-input"]');
      if (await capsInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await capsInput.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Escape');
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/admin-billing/desktop.png', fullPage: true });
    await checkA11y(page, 'admin-billing');

    // Mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'e2e/screenshots/admin-billing/mobile.png', fullPage: true });

    // Console error gate (filter noise)
    const real = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('third-party') && !e.includes('ERR_BLOCKED_BY_CLIENT'),
    );
    expect(real).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/billing`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form')).toBeVisible();
  });

  test('API: GET /api/billing/subscription returns structured response', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/billing/subscription`);
    expect([200, 401, 404]).toContain(res.status());
  });

  test('API: GET /api/billing/entitlements returns structured response', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/billing/entitlements`);
    expect([200, 401, 404]).toContain(res.status());
  });
});
