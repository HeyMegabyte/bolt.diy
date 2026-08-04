/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Analytics dashboard's 8 TABS all WORK
 * (`/admin/analytics`). Real-life verification (Brian, megabytespace, via Browserbase)
 * lives in `analytics-tabs-sweep.mjs`; THIS is the repeatable regression.
 *
 * Root cause fixed (2026-08-04, user request): 4 tabs — By Section / Forms / Visitor
 * Funnel / Site Health — 404'd their data endpoints (`/api/sites/:id/analytics/{sections,
 * forms,funnel}` + `/api/sites/:id/doctor`) because the `site_analytics` + `site_doctor`
 * feature flags were dark. Enabling both (global flag_overrides) made all 8 tabs live.
 *
 * This spec (1) proves the 8-tab strip renders + each tab activates + its panel shows,
 * and (2) gates on ZERO 4xx/5xx from the per-tab analytics/doctor endpoints across the
 * whole sweep — so if a flag ever goes dark again (endpoints 404), this fails.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./analytics-tabs-sweep.mjs}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const TABS = ['overview', 'live', 'funnel', 'sections', 'forms', 'visitor', 'health', 'social'] as const;

test.describe('Admin · Analytics tabs all work (P0-ADMIN)', () => {
  test('all 8 tabs render, activate on click, and their panels show', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="analytics-dashboard"]').waitFor({ state: 'visible', timeout: 15000 });

    // The full 8-tab strip renders.
    for (const id of TABS) {
      await expect(page.locator(`[data-testid="analytics-tab-${id}"]`), `the ${id} tab renders`).toBeVisible({
        timeout: 8000,
      });
    }

    // Each tab activates on click + its panel renders substantial content (real UI, not blank).
    for (const id of TABS) {
      const tab = page.locator(`[data-testid="analytics-tab-${id}"]`);
      await tab.click();
      await expect(tab, `clicking ${id} selects it`).toHaveAttribute('aria-selected', 'true', { timeout: 6000 });
      await page.waitForTimeout(400);
      const panelLen = await page.evaluate(
        () => (document.querySelector('main')?.innerText ?? document.body.innerText).trim().length,
      );
      expect(panelLen, `the ${id} tab panel renders content`).toBeGreaterThan(200);
    }
  });

  test('no per-tab analytics endpoint 404s across the whole tab sweep (flags live)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');

    // Collect any 4xx/5xx from the per-tab analytics/doctor endpoints (the flag-gated
    // ones that regress to 404 when site_analytics / site_doctor go dark).
    const bad: string[] = [];
    page.on('response', (res) => {
      const u = res.url();
      if (
        res.status() >= 400 &&
        /\/api\/sites\/[^/]+\/(analytics|doctor)/.test(u) &&
        !u.includes('/api/super-admin/')
      ) {
        bad.push(`${res.status()} ${u.replace('https://projectsites.dev', '')}`);
      }
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="analytics-dashboard"]').waitFor({ state: 'visible', timeout: 15000 });

    for (const id of TABS) {
      await page.locator(`[data-testid="analytics-tab-${id}"]`).click();
      await page.waitForTimeout(1200); // let the tab's data fetch resolve
    }
    await page.waitForTimeout(1500);

    expect(bad, `every analytics tab endpoint must resolve (no 404s) — saw: ${bad.join(' | ')}`).toEqual([]);
  });
});
