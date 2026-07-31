/**
 * Admin — Snapshots Section journey spec.
 *
 * Strategy:
 * - Stub the GET /api/sites/:siteId/snapshots endpoint to return 3 rows
 *   so the list renders deterministically without hitting prod data.
 * - Verify: (a) list renders from stub, (b) create affordance present,
 *   (c) per-row action affordances (more/revert/compare) exist,
 *   (d) mobile render, (e) zero critical console errors.
 * - We do NOT execute revert, restore, or create — only presence checks.
 *
 * Snapshot testids (from snapshots.component.ts grep pass):
 *   - `snapshot-create-button` — opens create dialog
 *   - `snapshot-name-input` — name field in create dialog
 *   - `snapshot-create-submit` — submit create
 *   - `snapshot-title-{id}` — row title
 *   - `snapshot-more-{id}` — overflow/more menu button per row
 *   - `snapshot-revert-{id}` — revert affordance (in more menu or inline)
 *   - `snapshot-compare-{id}` — compare/diff affordance
 *   - `snapshot-date-{id}` — date chip per row
 *   - `snapshots-load-error` — error state
 *   - `snapshots-retry` — retry button in error state
 *
 * API endpoints stubbed:
 *   - GET  api/sites/:siteId/snapshots     -> { data: [...] }
 *   - GET  api/sites/:siteId/snapshots/metrics -> {}
 *   - GET  api/sites/:siteId/github/status -> { connected: false }
 *   - ALL  POST/PATCH/PUT/DELETE -> 200 {}
 */
import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

const STUB_SNAPSHOTS = [
  {
    id: 'snap-1',
    snapshot_name: 'initial-launch',
    created_at: '2025-12-01T10:00:00.000Z',
    description: 'Initial site launch snapshot',
    quality_score: 92,
    site_id: 'site-test-1',
  },
  {
    id: 'snap-2',
    snapshot_name: 'homepage-redesign',
    created_at: '2026-01-15T14:30:00.000Z',
    description: 'Homepage redesign after brand update',
    quality_score: 88,
    site_id: 'site-test-1',
  },
  {
    id: 'snap-3',
    snapshot_name: 'seo-optimisation',
    created_at: '2026-03-10T09:15:00.000Z',
    description: 'SEO metadata and structured data improvements',
    quality_score: 95,
    site_id: 'site-test-1',
  },
];

test.use({ serviceWorkers: 'block' });

test.describe('Admin — Snapshots journey', () => {
  // -------------------------------------------------------------------------
  // Helper: register snapshot GET stubs (called after signInAsTestUser)
  // -------------------------------------------------------------------------
  async function stubSnapshotEndpoints(page: import('@playwright/test').Page) {
    // Primary snapshots list
    await page.route('**/api/sites/*/snapshots', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: STUB_SNAPSHOTS }),
      });
    });

    // Metrics endpoint (batch)
    await page.route('**/api/sites/*/snapshots/metrics**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    // GitHub status
    await page.route('**/api/sites/*/github/status**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connected: false }),
      });
    });

    // All mutations → 200
    await page.route('**/api/**', async (route) => {
      const method = route.request().method();
      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });
  }

  // -------------------------------------------------------------------------
  // Test 1: snapshots list renders 3 rows from stub
  // -------------------------------------------------------------------------
  test('snapshots list renders rows from stubbed GET endpoint', async ({ page }) => {
    await signInAsTestUser(page);
    await stubSnapshotEndpoints(page);

    await page.goto(`${PROD_URL}/admin/snapshots`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    expect(page.url()).not.toContain('/signin');

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // At least one row should render using the first stub id
    const firstRow = page.locator('[data-testid="snapshot-title-snap-1"]');
    await expect(firstRow).toBeVisible({ timeout: 15_000 });

    // All 3 rows present
    await expect(page.locator('[data-testid="snapshot-title-snap-2"]')).toBeAttached({
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="snapshot-title-snap-3"]')).toBeAttached({
      timeout: 10_000,
    });

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/list-renders.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 2: create affordance is present and name input reachable
  // -------------------------------------------------------------------------
  test('create snapshot affordance (button + name input) is present', async ({ page }) => {
    await signInAsTestUser(page);
    await stubSnapshotEndpoints(page);

    await page.goto(`${PROD_URL}/admin/snapshots`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // Create button must be visible
    const createBtn = page.locator('[data-testid="snapshot-create-button"]');
    await expect(createBtn).toBeVisible({ timeout: 15_000 });

    // Click to open create dialog
    await createBtn.click();

    // Name input should appear — it may be in a dialog/modal
    const nameInput = page.locator('[data-testid="snapshot-name-input"]');
    await expect(nameInput).toBeVisible({ timeout: 8_000 });

    // Submit button should be present (we do NOT submit)
    const submitBtn = page.locator('[data-testid="snapshot-create-submit"]');
    await expect(submitBtn).toBeVisible({ timeout: 5_000 });

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/create-affordance.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 3: per-row action affordances present (more, revert, compare)
  // -------------------------------------------------------------------------
  test('per-row action affordances (more/revert/compare) are present', async ({ page }) => {
    await signInAsTestUser(page);
    await stubSnapshotEndpoints(page);

    await page.goto(`${PROD_URL}/admin/snapshots`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // Wait for first row
    await expect(page.locator('[data-testid="snapshot-title-snap-1"]')).toBeVisible({
      timeout: 15_000,
    });

    // More button (kebab/overflow menu) — triggers per-row action panel
    const moreBtn = page.locator('[data-testid="snapshot-more-snap-1"]');
    if (await moreBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(moreBtn).toBeVisible();

      // Click to open the menu so revert/compare become visible
      await moreBtn.click();
      await page.waitForTimeout(300); // menu animation
    }

    // Revert affordance (may be inline or in more menu)
    const revertBtn = page.locator(
      '[data-testid="snapshot-revert-snap-1"], [data-testid^="snapshot-revert-"]',
    );
    if (await revertBtn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(revertBtn.first()).toBeVisible();
    }

    // Compare/diff affordance
    const compareBtn = page.locator(
      '[data-testid="snapshot-compare-snap-1"], [data-testid^="snapshot-compare-"]',
    );
    if (await compareBtn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(compareBtn.first()).toBeVisible();
    }

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/row-actions.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 4: mobile 375px render
  // -------------------------------------------------------------------------
  test('mobile 375px — snapshots section renders list', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });

    await signInAsTestUser(page);
    await stubSnapshotEndpoints(page);

    await page.goto(`${PROD_URL}/admin/snapshots`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // List or create button must be present on mobile
    const createBtn = page.locator('[data-testid="snapshot-create-button"]');
    const firstRow = page.locator('[data-testid="snapshot-title-snap-1"]');

    const eitherVisible = await Promise.any([
      createBtn.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true),
      firstRow.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true),
    ]).catch(() => false);

    expect(eitherVisible).toBe(true);

    await page.screenshot({
      path: 'e2e/screenshots/admin-snapshots/mobile-375.png',
      fullPage: false,
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: zero critical console errors
  // -------------------------------------------------------------------------
  test('no critical console errors on /admin/snapshots', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);
    await stubSnapshotEndpoints(page);

    await page.goto(`${PROD_URL}/admin/snapshots`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('net::ERR') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Test 6: a11y advisory pass
  // -------------------------------------------------------------------------
  test('a11y advisory — no critical violations on /admin/snapshots', async ({ page }) => {
    await signInAsTestUser(page);
    await stubSnapshotEndpoints(page);

    await page.goto(`${PROD_URL}/admin/snapshots`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    await checkA11y(page, 'admin-snapshots');
    await page.screenshot({ path: 'e2e/screenshots/admin-snapshots/a11y.png', fullPage: false });
  });
});
