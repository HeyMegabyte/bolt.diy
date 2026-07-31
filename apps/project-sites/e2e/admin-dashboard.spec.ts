/**
 * Admin Dashboard — authenticated E2E journey.
 *
 * First working authenticated admin spec. Tests /admin (dashboard) which
 * has NO sysAdminGuard — only the authGuard.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

/** Inline session injection + API stubs that we KNOW work (verified in debug-init.spec.ts). */
async function signInAsAdmin(page: any, email: string) {
  await page.context().addInitScript(
    ({ t, id }: { t: string; id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: 'e2e-stub-session-token', id: email },
  );

  await page.route('**/api/auth/me', async (route: any) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { user_id: 'e2e', email, name: 'E2E Test', org_id: 'e2e-org', is_super_admin: true } }),
    });
  });
  await page.route('**/api/sites**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], meta: { total: 0 } }) });
  });
  await page.route('**/api/billing/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/feature-flags', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ flags: {}, count: 90 }) });
  });
  await page.route('**/api/admin/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/analytics/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

test.describe('Admin — Dashboard (authenticated)', () => {
  test('auth guard passes → admin shell renders → dashboard content visible', async ({ page }) => {
    const email = 'brian@megabyte.space';
    await signInAsAdmin(page, email);
    await page.goto(`${PROD_URL}/admin`, { waitUntil: 'domcontentloaded', timeout: 20_000 });

    const url = page.url();
    expect(url).not.toContain('/signin');

    // Admin shell must render
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Dashboard should show some content (not blank)
    const mainContent = page.locator('app-admin main, [data-cockpit="v2"] main, router-outlet + *');
    await expect(mainContent.first()).toBeVisible({ timeout: 15_000 });

    // No console errors
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.waitForTimeout(3_000);
    const realErrors = errors.filter(e => !e.includes('favicon') && !e.includes('third-party'));
    expect(realErrors).toEqual([]);
  });
});
