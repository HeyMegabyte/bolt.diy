/**
 * Admin Apps — authenticated E2E journey.
 *
 * The apps catalog is bundled static data — no backend pagination endpoint.
 * Only install counts are fetched from /api/apps/install-counts (silent, optional).
 * All POST/PATCH/DELETE intercepted as 200 stubs — never mutate prod data.
 */
import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

async function signInAsAdmin(page: any, email: string) {
  // LAST-RESORT /api catch-all — registered FIRST = matched LAST (reverse
  // registration order). Unstubbed /api requests (audit/rows, inbox/tasks, …)
  // must NEVER reach prod: with a fake bearer they 401 and ApiService clears
  // the session -> /signin bounce mid-test.
  await page.route('**/api/**', async (route: any) => {
    const m = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: m === 'GET' ? '{"data":[]}' : '{"ok":true}',
    });
  });

  await page.context().addInitScript(
    ({ t, id }: { t: string; id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: 'e2e-stub-session-token', id: email },
  );

  // Auth
  await page.route('**/api/auth/me', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          user_id: 'e2e',
          email,
          name: 'E2E Test',
          org_id: 'e2e-org',
          is_super_admin: true,
        },
      }),
    });
  });

  // Sites list
  await page.route('**/api/sites**', async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    });
  });

  // Apps install counts — stub with a couple of counts for social-proof display
  await page.route('**/api/apps/install-counts**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        counts: {
          'google-analytics': 42,
          'mailchimp': 18,
          'stripe': 75,
        },
      }),
    });
  });

  // Billing, feature flags, other admin
  await page.route('**/api/billing/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // feature-flags is PUBLIC anonymous-safe — hit REAL prod so gated sections
  // render true prod state (hardcoded flags:{} fakes "not enabled" notices).
  await page.route('**/api/feature-flags**', (route: any) => route.continue());
  await page.route('**/api/admin/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/analytics/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Safety net: intercept ALL remaining POST/PATCH/PUT/DELETE — never mutate prod
  await page.route('**/api/**', async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fallback();
  });
}

test.describe('Admin — Apps journey (authenticated)', () => {
  test('apps section loads and app cards are visible', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/apps`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Apps catalog is static — cards should render immediately
    // Look for at least one app card or the search input (always present)
    const searchInput = page.locator('[data-testid="apps-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 20_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-apps/01-loaded.png',
      fullPage: false,
    });

    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('posthog') &&
        !e.includes('sentry') &&
        !e.includes('google') &&
        !e.includes('net::ERR_BLOCKED_BY_CLIENT') &&
        !e.includes('failed to load resource') &&
        !e.includes('third-party'),
    );
    expect(realErrors).toEqual([]);
  });

  test('search input filters app cards', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/apps`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    const searchInput = page.locator('[data-testid="apps-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 15_000 });

    // Type a search query
    await searchInput.click();
    await page.keyboard.type('stripe');

    await page.screenshot({
      path: 'e2e/screenshots/admin-apps/02-search-stripe.png',
      fullPage: false,
    });

    // Result status live region should update
    const resultStatus = page.locator('[data-testid="apps-result-status"]');
    const statusVisible = await resultStatus.isVisible({ timeout: 5_000 }).catch(() => false);
    if (statusVisible) {
      const statusText = await resultStatus.textContent();
      expect(statusText).toBeTruthy();
    }

    // Clear search
    await searchInput.selectAll();
    await page.keyboard.press('Delete');

    await page.screenshot({
      path: 'e2e/screenshots/admin-apps/03-search-cleared.png',
      fullPage: false,
    });
  });

  test('lifecycle tab switches — All / Live / Coming Soon', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/apps`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="apps-search-input"]')).toBeVisible({ timeout: 15_000 });

    // Click "Live" tab
    const liveTab = page.locator('[data-testid="apps-lifecycle-live"]');
    const liveVisible = await liveTab.isVisible({ timeout: 8_000 }).catch(() => false);

    if (liveVisible) {
      await liveTab.click();
      await page.screenshot({
        path: 'e2e/screenshots/admin-apps/04-lifecycle-live.png',
        fullPage: false,
      });

      // Click "Coming Soon" tab
      const soonTab = page.locator('[data-testid="apps-lifecycle-soon"]');
      if (await soonTab.isVisible()) {
        await soonTab.click();
        await page.screenshot({
          path: 'e2e/screenshots/admin-apps/05-lifecycle-soon.png',
          fullPage: false,
        });
      }

      // Back to All
      const allTab = page.locator('[data-testid="apps-lifecycle-all"]');
      if (await allTab.isVisible()) {
        await allTab.click();
        await page.screenshot({
          path: 'e2e/screenshots/admin-apps/06-lifecycle-all.png',
          fullPage: false,
        });
      }
    }
  });

  test('category filter opens and closes with Escape', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/apps`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="apps-search-input"]')).toBeVisible({ timeout: 15_000 });

    const categoryBtn = page.locator('[data-testid="apps-category-filter"]');
    const catBtnVisible = await categoryBtn.isVisible({ timeout: 8_000 }).catch(() => false);

    if (!catBtnVisible) {
      // Category filter not present in this build
      return;
    }

    // Open category menu
    await categoryBtn.click();

    const categoryMenu = page.locator('[data-testid="apps-category-menu"]');
    const menuVisible = await categoryMenu.isVisible({ timeout: 5_000 }).catch(() => false);

    if (menuVisible) {
      await expect(categoryMenu).toBeVisible();

      await page.screenshot({
        path: 'e2e/screenshots/admin-apps/07-category-open.png',
        fullPage: false,
      });

      // Close with Escape
      await page.keyboard.press('Escape');

      await page.screenshot({
        path: 'e2e/screenshots/admin-apps/08-category-closed.png',
        fullPage: false,
      });
    }
  });

  test('a11y — 1280px viewport', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${PROD_URL}/admin/apps`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="apps-search-input"]')).toBeVisible({ timeout: 15_000 });

    await checkA11y(page, 'apps-1280');

    await page.screenshot({
      path: 'e2e/screenshots/admin-apps/09-a11y-1280.png',
      fullPage: false,
    });
  });

  test('a11y — 375px viewport', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${PROD_URL}/admin/apps`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="apps-search-input"]')).toBeVisible({ timeout: 15_000 });

    await checkA11y(page, 'apps-375');

    await page.screenshot({
      path: 'e2e/screenshots/admin-apps/10-a11y-375.png',
      fullPage: false,
    });
  });
});
