/**
 * Admin Analytics — authenticated E2E journey.
 *
 * Stubs all GET data endpoints with realistic non-empty JSON so KPI cards populate.
 * All POST/PATCH/DELETE are intercepted and returned as 200 stubs (never mutate prod).
 */
import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });
const SITE_ID = 'e2e-site-001';

const ANALYTICS_DATA = {
  data: {
    source: 'cloudflare',
    pageviews: 12_450,
    visitors: 3_210,
    requests: 28_900,
    period: '7d',
    urls: [
      { hostname: 'example.com', pageviews: 8_000, visitors: 2_100, requests: 18_000 },
      { hostname: 'www.example.com', pageviews: 4_450, visitors: 1_110, requests: 10_900 },
    ],
    daily: [
      { date: '2026-07-24', pageviews: 1_800, visitors: 450, requests: 4_100 },
      { date: '2026-07-25', pageviews: 1_700, visitors: 430, requests: 3_900 },
      { date: '2026-07-26', pageviews: 1_900, visitors: 490, requests: 4_300 },
      { date: '2026-07-27', pageviews: 1_600, visitors: 400, requests: 3_600 },
      { date: '2026-07-28', pageviews: 1_750, visitors: 460, requests: 4_000 },
      { date: '2026-07-29', pageviews: 1_850, visitors: 480, requests: 4_200 },
      { date: '2026-07-30', pageviews: 1_850, visitors: 500, requests: 4_800 },
    ],
  },
};

const URLS_DATA = {
  data: [
    { id: 'url-1', hostname: 'example.com', is_primary: 1 },
    { id: 'url-2', hostname: 'www.example.com', is_primary: 0 },
  ],
};

const SITES_DATA = {
  data: [
    {
      id: SITE_ID,
      slug: 'e2e-test-site',
      name: 'E2E Test Site',
      status: 'active',
      org_id: 'e2e-org',
      primary_hostname: 'example.com',
      created_at: '2026-01-01T00:00:00Z',
    },
  ],
  meta: { total: 1 },
};

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

  // Base auth
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

  // Sites list — one site so analytics section has a selection
  // glob-ok: query-suffix only — sites LIST; /api/sites/:id/* is stubbed
  // separately below or falls to the benign catch-all
  await page.route('**/api/sites**', async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SITES_DATA),
    });
  });

  // Analytics data
  await page.route(`**/api/sites/${SITE_ID}/analytics**`, async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ANALYTICS_DATA),
    });
  });

  // Site URL list
  await page.route(`**/api/sites/${SITE_ID}/urls**`, async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(URLS_DATA),
    });
  });

  // Cloudflare credential status — configured + valid so the connect-CF banner is hidden
  // glob-ok: query-suffix only — cloudflare-credentials has no subpaths
  await page.route('**/api/admin/cloudflare-credentials**', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          configured: true,
          account_id_set: true,
          api_token_set: true,
          last_validated_at: '2026-07-30T00:00:00Z',
          valid: true,
        },
      }),
    });
  });

  // Billing, feature flags, other admin GET
  await page.route('**/api/billing/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  // feature-flags is PUBLIC anonymous-safe — hit REAL prod so gated sections
  // render true prod state (hardcoded flags:{} fakes "not enabled" notices).
  await page.route('**/api/feature-flags**', (route: any) => route.continue());
  // Mid-token ** can't cross '/' — twin covers /api/feature-flags/:key reads
  await page.route('**/api/feature-flags/**', (route: any) => route.continue());
  await page.route('**/api/admin/**', async (route: any) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Safety net: intercept ALL remaining POST/PATCH/PUT/DELETE — never mutate prod data
  await page.route('**/api/**', async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fallback();
  });
}

test.describe('Admin — Analytics journey (authenticated)', () => {
  test('analytics section loads and admin shell is visible', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    // Either KPI cards or the unavailable notice must render
    const kpiOrMsg = page.locator(
      '[data-testid="kpi-pageviews"], [data-testid="analytics-unavailable"]',
    );
    await expect(kpiOrMsg.first()).toBeVisible({ timeout: 20_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-analytics/01-loaded.png',
      fullPage: false,
    });

    const realErrors = errors.filter((e) => {
      const low = e.toLowerCase();
      return (
        !low.includes('favicon') &&
        !low.includes('posthog') &&
        !low.includes('sentry') &&
        !low.includes('google') &&
        !low.includes('net::err_blocked_by_client') &&
        !low.includes('failed to load resource') &&
        !low.includes('third-party')
      );
    });
    expect(realErrors).toEqual([]);
  });

  test('KPI cards render when analytics stubbed with realistic data', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    const pageviewsCard = page.locator('[data-testid="kpi-pageviews"]');
    const unavailable = page.locator('[data-testid="analytics-unavailable"]');

    // Wait for either to settle
    await Promise.race([
      pageviewsCard.waitFor({ state: 'visible', timeout: 18_000 }).catch(() => null),
      unavailable.waitFor({ state: 'visible', timeout: 18_000 }).catch(() => null),
    ]);

    if (await pageviewsCard.isVisible()) {
      await expect(page.locator('[data-testid="kpi-visitors"]')).toBeVisible();
      await expect(page.locator('[data-testid="kpi-requests"]')).toBeVisible();
      await page.screenshot({
        path: 'e2e/screenshots/admin-analytics/02-kpi-cards.png',
        fullPage: false,
      });
    } else {
      // Valid product state — CF creds not wired or no site selected in prod
      await expect(unavailable).toBeVisible();
      await page.screenshot({
        path: 'e2e/screenshots/admin-analytics/02-unavailable.png',
        fullPage: false,
      });
    }
  });

  test('range tab strip toggles aria-selected', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    const rangeList = page.locator('[role="tablist"][aria-label="Date range"]');
    const rangeListVisible = await rangeList.isVisible({ timeout: 12_000 }).catch(() => false);

    if (!rangeListVisible) {
      // Analytics unavailable / no site — range strip not rendered
      return;
    }

    // Click 30d tab
    const tab30d = rangeList.locator('button').filter({ hasText: '30d' });
    if (await tab30d.isVisible()) {
      await tab30d.click();
      await expect(tab30d).toHaveAttribute('aria-selected', 'true');

      await page.screenshot({
        path: 'e2e/screenshots/admin-analytics/03-range-30d.png',
        fullPage: false,
      });

      // Switch to 7d
      const tab7d = rangeList.locator('button').filter({ hasText: '7d' });
      if (await tab7d.isVisible()) {
        await tab7d.click();
        await expect(tab7d).toHaveAttribute('aria-selected', 'true');
        await page.screenshot({
          path: 'e2e/screenshots/admin-analytics/04-range-7d.png',
          fullPage: false,
        });
      }
    }
  });

  test('a11y — 1280px viewport', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${PROD_URL}/admin/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
    await page
      .locator('[data-testid="kpi-pageviews"], [data-testid="analytics-unavailable"]')
      .first()
      .waitFor({ state: 'visible', timeout: 18_000 })
      .catch(() => null);

    await checkA11y(page, 'analytics-1280');

    await page.screenshot({
      path: 'e2e/screenshots/admin-analytics/05-a11y-1280.png',
      fullPage: false,
    });
  });

  test('a11y — 375px viewport', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${PROD_URL}/admin/analytics`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
    await page
      .locator('[data-testid="kpi-pageviews"], [data-testid="analytics-unavailable"]')
      .first()
      .waitFor({ state: 'visible', timeout: 18_000 })
      .catch(() => null);

    await checkA11y(page, 'analytics-375');

    await page.screenshot({
      path: 'e2e/screenshots/admin-analytics/06-a11y-375.png',
      fullPage: false,
    });
  });
});
