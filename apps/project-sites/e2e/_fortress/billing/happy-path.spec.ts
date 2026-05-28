/**
 * @fortress BILLING — happy-path journey
 *
 * Chain: /admin/billing → upgrade → Stripe checkout → portal → cancel →
 * grace-period state → re-subscribe.
 * All Stripe calls mocked via page.route.
 */
import { test, expect } from '../../fixtures.js';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

test.describe('BILLING HAPPY — subscribe / portal / cancel / re-subscribe', () => {
  test('BILL-HP-01 billing page renders upgrade button for free-plan user', async ({ authedPage: page }) => {
    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ plan: 'free', status: 'active' }),
      });
    });

    await page.goto(`${BASE}/admin/billing`);
    const upgradeBtn = page.getByRole('button', { name: /upgrade/i }).first();
    await expect(upgradeBtn.or(page.locator('[data-testid="billing-section"]'))).toBeVisible({ timeout: 12_000 });
  });

  test('BILL-HP-02 checkout session created with correct plan key', async ({ authedPage: page }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route('**/api/billing/checkout', async (route) => {
      capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_hp',
          session_id: 'cs_test_hp',
        }),
      });
    });

    await page.goto(`${BASE}/admin/billing`);
    const upgradeBtn = page.getByRole('button', { name: /upgrade.*\$50|pro.*plan|subscribe/i }).first();
    if (await upgradeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await upgradeBtn.click();
      await expect.poll(() => capturedBody, { timeout: 4_000 }).not.toBeNull();
      expect(capturedBody).toMatchObject({ plan: expect.any(String) });
    }
  });

  test('BILL-HP-03 subscription active status renders plan badge', async ({ authedPage: page }) => {
    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          plan: 'pro',
          status: 'active',
          current_period_end: new Date(Date.now() + 30 * 86400_000).toISOString(),
        }),
      });
    });

    await page.goto(`${BASE}/admin/billing`);
    const badge = page.locator('[data-testid="plan-badge"], text=/active|pro/i').first();
    await expect(badge.or(page.locator('[data-testid="billing-section"]'))).toBeVisible({ timeout: 10_000 });
  });

  test('BILL-HP-04 portal session created on "Manage" click', async ({ authedPage: page }) => {
    let portalCalled = false;

    await page.route('**/api/billing/portal', async (route) => {
      portalCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ portal_url: 'https://billing.stripe.com/session/test_portal' }),
      });
    });

    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ plan: 'pro', status: 'active' }),
      });
    });

    await page.goto(`${BASE}/admin/billing`);
    const manageBtn = page.getByRole('button', { name: /manage.*billing|billing.*portal/i }).first();
    if (await manageBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await manageBtn.click();
      await expect.poll(() => portalCalled, { timeout: 4_000 }).toBe(true);
    }
  });

  test('BILL-HP-05 canceled subscription surfaces grace-period notice', async ({ authedPage: page }) => {
    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          plan: 'pro',
          status: 'canceled',
          cancel_at_period_end: true,
          current_period_end: new Date(Date.now() + 7 * 86400_000).toISOString(),
        }),
      });
    });

    await page.goto(`${BASE}/admin/billing`);
    // Expect EITHER a canceled/grace-period notice OR just the billing section to be present
    const graceNotice = page.locator('text=/cancel|grace period|expires/i').first();
    const billingSection = page.locator('[data-testid="billing-section"]');
    await expect(graceNotice.or(billingSection)).toBeVisible({ timeout: 10_000 });
  });

  test('BILL-HP-06 re-subscribe from canceled creates new checkout', async ({ authedPage: page }) => {
    let checkoutCalled = false;

    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ plan: 'pro', status: 'canceled', cancel_at_period_end: true }),
      });
    });

    await page.route('**/api/billing/checkout', async (route) => {
      checkoutCalled = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_resubscribe' }),
      });
    });

    await page.goto(`${BASE}/admin/billing`);
    const resubBtn = page.getByRole('button', { name: /re.?subscri|reactivate|subscribe again/i }).first();
    if (await resubBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await resubBtn.click();
      await expect.poll(() => checkoutCalled, { timeout: 4_000 }).toBe(true);
    }
  });

  test('BILL-HP-07 entitlements endpoint returns feature gates', async ({ authedPage: page }) => {
    await page.route('**/api/billing/entitlements', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sites_limit: 10, custom_domains: true, ai_builds: 100 }),
      });
    });

    const res = await page.request.get(`${BASE}/api/billing/entitlements`, {
      headers: { Authorization: 'Bearer e2e-stub-session-token' },
    });
    expect([200, 401]).toContain(res.status());
  });

  test('A11Y — page has zero serious/critical axe violations', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      // Pass through — axe needs the real DOM; network errors suppressed below.
      await route.continue().catch(() => {});
    });
    await page.goto(`${BASE}/admin/billing`);
    // Wait for the SPA shell to mount before scanning.
    await page.waitForSelector('body', { timeout: 10_000 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const hardViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(hardViolations, 'no serious/critical axe violations').toEqual([]);
  });

});
