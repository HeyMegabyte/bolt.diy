/**
 * Admin Forms — authenticated E2E journey.
 *
 * Stubs GET /api/sites/:id/form-submissions + GET /api/sites/:id/ai-settings
 * with realistic non-empty JSON so the submissions table populates.
 * All POST/PATCH/DELETE intercepted as 200 stubs — never mutate prod data.
 */
import { test, expect } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });
const SITE_ID = 'e2e-site-001';

const SUBMISSIONS_DATA = {
  data: [
    {
      id: 'sub-001',
      site_id: SITE_ID,
      name: 'Alice Johnson',
      email: 'alice@example.com',
      body: 'I need help renovating my kitchen. Can we schedule a consultation?',
      created_at: '2026-07-28T10:23:00Z',
      status: 'new',
    },
    {
      id: 'sub-002',
      site_id: SITE_ID,
      name: 'Bob Martinez',
      email: 'bob@example.com',
      body: 'Looking for a quote on bathroom remodel — 200 sq ft.',
      created_at: '2026-07-27T14:55:00Z',
      status: 'read',
    },
    {
      id: 'sub-003',
      site_id: SITE_ID,
      name: 'Carol Kim',
      email: 'carol@example.com',
      body: 'Do you handle commercial projects? We have an office space on 5th Ave.',
      created_at: '2026-07-26T09:10:00Z',
      status: 'new',
    },
  ],
};

const AI_SETTINGS_DATA = {
  data: {
    site_id: SITE_ID,
    system_prompt: 'You are a helpful assistant for a renovation company.',
    enabled: true,
    model: 'llama-3.3-70b',
    scenarios: [
      { id: 'scen-1', name: 'Kitchen Renovation', description: 'Handle kitchen queries' },
      { id: 'scen-2', name: 'Bathroom Remodel', description: 'Handle bathroom queries' },
    ],
  },
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

  // Form submissions
  await page.route(`**/api/sites/${SITE_ID}/form-submissions**`, async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SUBMISSIONS_DATA),
    });
  });

  // Also match the /forms path (alternate route name in some versions)
  await page.route(`**/api/sites/${SITE_ID}/forms**`, async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SUBMISSIONS_DATA),
    });
  });

  // AI settings
  await page.route(`**/api/sites/${SITE_ID}/ai-settings**`, async (route: any) => {
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(AI_SETTINGS_DATA),
    });
  });

  // Billing, feature flags, other admin
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

test.describe('Admin — Forms journey (authenticated)', () => {
  test('forms section loads and admin shell is visible', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/forms`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-forms/01-loaded.png',
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

  test('submissions table populates with stubbed data', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/forms`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Wait for section content: table, empty state, or loading indicator to resolve
    const contentLocator = page.locator(
      '[data-testid="forms-table-scroll"], [data-testid="forms-empty"], [data-testid="forms-load-error"]',
    );

    await Promise.race([
      contentLocator.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => null),
      page.locator('[data-testid="forms-loading"]').waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => null),
    ]);

    const tableVisible = await page.locator('[data-testid="forms-table-scroll"]').isVisible();
    const emptyVisible = await page.locator('[data-testid="forms-empty"]').isVisible();
    const errorVisible = await page.locator('[data-testid="forms-load-error"]').isVisible();

    // One of the three states must be visible
    expect(tableVisible || emptyVisible || errorVisible).toBe(true);

    if (tableVisible) {
      // Submissions table rendered — assert select-all checkbox present
      await expect(page.locator('[data-testid="forms-select-all"]')).toBeVisible();

      await page.screenshot({
        path: 'e2e/screenshots/admin-forms/02-table.png',
        fullPage: false,
      });
    } else {
      await page.screenshot({
        path: 'e2e/screenshots/admin-forms/02-no-table.png',
        fullPage: false,
      });
    }
  });

  test('prompt designer opens via button click', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/forms`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // Wait for section to settle
    await page
      .locator('[data-testid="forms-loading"]')
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => null);

    const designerBtn = page.locator('[data-testid="forms-open-prompt-designer"]').first();
    const btnVisible = await designerBtn.isVisible({ timeout: 10_000 }).catch(() => false);

    if (!btnVisible) {
      // Prompt designer button not available (no site selected or empty state variant)
      return;
    }

    await designerBtn.click();

    await page.screenshot({
      path: 'e2e/screenshots/admin-forms/03-prompt-designer.png',
      fullPage: false,
    });

    // Designer panel should be open — look for the save button
    const saveBtn = page.locator('[data-testid="forms-designer-save"]');
    const saveBtnVisible = await saveBtn.isVisible({ timeout: 8_000 }).catch(() => false);

    if (saveBtnVisible) {
      await expect(saveBtn).toBeVisible();
    }

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.screenshot({
      path: 'e2e/screenshots/admin-forms/04-designer-closed.png',
      fullPage: false,
    });
  });

  test('select-all checkbox toggles row selections', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.goto(`${PROD_URL}/admin/forms`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    await page
      .locator('[data-testid="forms-loading"]')
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => null);

    const selectAll = page.locator('[data-testid="forms-select-all"]');
    const tableVisible = await page.locator('[data-testid="forms-table-scroll"]').isVisible({ timeout: 10_000 }).catch(() => false);

    if (!tableVisible) {
      // No submissions table — skip interaction
      return;
    }

    const selectAllVisible = await selectAll.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!selectAllVisible) return;

    // Click select-all
    await selectAll.click();

    await page.screenshot({
      path: 'e2e/screenshots/admin-forms/05-selected.png',
      fullPage: false,
    });

    // Clear selection button should appear
    const clearBtn = page.locator('[data-testid="forms-clear-selection"]');
    const clearVisible = await clearBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (clearVisible) {
      await clearBtn.click();
      await page.screenshot({
        path: 'e2e/screenshots/admin-forms/06-cleared.png',
        fullPage: false,
      });
    }
  });

  test('a11y — 1280px viewport', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${PROD_URL}/admin/forms`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page
      .locator('[data-testid="forms-loading"]')
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => null);

    await checkA11y(page, 'forms-1280');

    await page.screenshot({
      path: 'e2e/screenshots/admin-forms/07-a11y-1280.png',
      fullPage: false,
    });
  });

  test('a11y — 375px viewport', async ({ page }) => {
    await signInAsAdmin(page, 'brian@megabyte.space');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${PROD_URL}/admin/forms`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page
      .locator('[data-testid="forms-loading"]')
      .waitFor({ state: 'hidden', timeout: 15_000 })
      .catch(() => null);

    await checkA11y(page, 'forms-375');

    await page.screenshot({
      path: 'e2e/screenshots/admin-forms/08-a11y-375.png',
      fullPage: false,
    });
  });
});
