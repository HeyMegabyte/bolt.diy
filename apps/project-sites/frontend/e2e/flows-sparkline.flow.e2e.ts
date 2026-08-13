/**
 * flows-sparkline.flow.e2e.ts — Surface: the visits sparkline (feature
 * `site_health_sparklines`) on /admin/snapshots (beside the readiness panel).
 *
 * FINISHED this fire: the worker endpoint (`GET /api/sites/:id/sparkline`) + flag
 * were live but had NO UI consumer, and `analytics_daily` was empty for the site.
 * Built `<app-health-sparkline>` (reacts to `AdminStateService.selectedSite()`) +
 * wired it under the readiness panel + SEEDED 7 days of traffic for the default
 * site (e2e-site-3 / urban-fitness): visits [14,22,18,31,27,44,38] = 194 total,
 * peak 44.
 *
 * Real testids: health-sparkline, sparkline-svg, sparkline-total, sparkline-peak.
 *
 * Run: E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts flows-sparkline.flow --workers=3
 */
import { test, expect } from '@playwright/test';
import { hasKey, seedSession, gotoAdmin, attachConsole, expectClean, snap, apiFetch } from './_flow-helpers';

const SPARK = '[data-testid="health-sparkline"]';
const SEEDED_SITE = 'e2e-site-3';

test.describe('Full-flow · visits sparkline', () => {
  test.skip(!hasKey, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  test('01 the visits sparkline renders on /admin/snapshots with a total', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(SPARK), 'the sparkline card renders').toBeVisible({ timeout: 20_000 });
    await expect(page.locator(SPARK)).toContainText(/visits/i);
    const total = Number((await page.locator('[data-testid="sparkline-total"]').innerText()).replace(/\D/g, ''));
    expect(total, 'a positive total renders').toBeGreaterThan(0);
    await snap(page, 'sparkline-01-render');
    expectClean(errors);
  });

  test('02 the SVG sparkline draws a multi-point polyline', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(SPARK)).toBeVisible({ timeout: 20_000 });
    const svg = page.locator('[data-testid="sparkline-svg"]');
    await expect(svg).toBeVisible();
    const points = await svg.locator('polyline').getAttribute('points');
    expect(points ?? '', 'the polyline has coordinates').toMatch(/\d+(\.\d+)?,\d+(\.\d+)?/);
    // Multiple points (a trend, not a single dot).
    const nPoints = (points ?? '').trim().split(/\s+/).filter(Boolean).length;
    expect(nPoints, 'the trend has several points').toBeGreaterThanOrEqual(3);
    await snap(page, 'sparkline-02-svg');
  });

  test('03 ground-truth: the widget total reconciles with the sparkline API store', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(SPARK)).toBeVisible({ timeout: 20_000 });
    const api = await apiFetch<{ days: { visits: number }[] }>(page, `/api/sites/${SEEDED_SITE}/sparkline?days=7`);
    expect(api.status).toBe(200);
    const apiTotal = (api.body.days ?? []).reduce((s, d) => s + d.visits, 0);
    expect(apiTotal, 'the seeded store has traffic').toBeGreaterThan(0);
    const uiTotal = Number((await page.locator('[data-testid="sparkline-total"]').innerText()).replace(/\D/g, ''));
    expect(uiTotal, 'display total reconciles with the store').toBe(apiTotal);
  });

  test('04 the peak-per-day reconciles with the store', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(SPARK)).toBeVisible({ timeout: 20_000 });
    const api = await apiFetch<{ days: { visits: number }[] }>(page, `/api/sites/${SEEDED_SITE}/sparkline?days=7`);
    const apiPeak = Math.max(0, ...(api.body.days ?? []).map((d) => d.visits));
    const uiPeak = Number((await page.locator('[data-testid="sparkline-peak"]').innerText()).replace(/\D/g, ''));
    expect(uiPeak, 'the peak/day reconciles with the store').toBe(apiPeak);
  });

  test('05 the sparkline surface is console-error-free', async ({ page }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(SPARK)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    expectClean(errors);
  });

  test('06 deep-link + reload preserves the sparkline (session + flag intact)', async ({ page }) => {
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    await expect(page.locator(SPARK)).toBeVisible({ timeout: 20_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(SPARK), 'still there after reload').toBeVisible({ timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/signin/);
  });

  test('07 full journey: open snapshots → readiness + sparkline both present → traffic reconciled', async ({
    page,
  }) => {
    const errors = attachConsole(page);
    await seedSession(page);
    await gotoAdmin(page, '/admin/snapshots');
    // The two per-site panels on snapshots both render.
    await expect(page.locator('[data-testid="readiness-panel"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(SPARK)).toBeVisible();
    const api = await apiFetch<{ days: unknown[] }>(page, `/api/sites/${SEEDED_SITE}/sparkline?days=7`);
    expect(api.status).toBe(200);
    expect((api.body.days ?? []).length, 'the store has a multi-day trend').toBeGreaterThanOrEqual(2);
    await snap(page, 'sparkline-07-journey');
    expectClean(errors);
  });
});
