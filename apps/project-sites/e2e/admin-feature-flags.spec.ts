/**
 * Admin Feature Flags — authenticated E2E journey.
 *
 * Template for all 35+ admin section specs.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Admin — Feature Flags (authenticated)', () => {
  test('sign in → navigate → feature flags render', async ({ page }) => {
    const email = 'brian@megabyte.space';

    // Inline the flow that works in debug-init.spec.ts
    await page.context().addInitScript(
      ({ t, id }: { t: string; id: string }) => {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
        );
      },
      { t: 'e2e-stub-session-token', id: email },
    );

    // Stub critical API endpoints
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ data: { user_id: 'test', email, name: 'E2E', org_id: 'e2e-test-org', is_super_admin: true } }),
      });
    });
    await page.route('**/api/sites**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { total: 0 } }) });
    });
    await page.route('**/api/billing/subscription', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: 'pro', status: 'active' }) });
    });
    await page.route('**/api/feature-flags', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: {}, count: 90 }) });
    });
    await page.route('**/api/super-admin/feature-flags', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: [], count: 0 }) });
    });
    await page.route('**/api/admin/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    // Navigate to admin
    await page.goto(`${PROD_URL}/admin/feature-flags`, { waitUntil: 'domcontentloaded', timeout: 20_000 });

    // Verify we're not on signin
    const url = page.url();
    expect(url).not.toContain('/signin');

    // Wait for admin shell
    await page.waitForSelector('app-admin, [data-cockpit="v2"]', { timeout: 20_000 });

    // Wait for feature-flags component (lazy-loaded)
    await page.waitForSelector('app-admin-feature-flags', { timeout: 30_000 });

    // Assert flags are visible
    const flagRows = page.locator('[data-testid*="flag"], .ff-card, [class*="flag-row"]');
    const count = await flagRows.count();
    expect(count).toBeGreaterThan(0);
  });
});
