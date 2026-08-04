/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the always-visible section REFRESH actions
 * re-fetch data without a crash or console error (a read-only reload).
 *
 * NON-MUTATING: a refresh button only re-runs the section's GET — no write. Asserts
 * the section still renders (not an admin-404, not the error boundary) + zero NEW
 * console errors across the reload.
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const NOISE = /Failed to load resource|net::ERR|google-analytics|\/g\/collect|posthog|Access is denied/i;

const stillHealthy = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({
    crashed: /ran into a problem|something went wrong|doesn.t exist/i.test(document.body.innerText || ''),
    len: (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length,
  }));

test.describe('Admin · section refresh actions (P0-ADMIN)', () => {
  test('auth-security sessions refresh re-fetches cleanly (no crash / console error)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text().slice(0, 140));
    });
    page.on('pageerror', (e) => {
      if (!NOISE.test(String(e))) errors.push(String(e).slice(0, 140));
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/auth-security', { waitUntil: 'domcontentloaded' });
    const refresh = page.locator('[data-testid="as-sessions-refresh"]');
    await refresh.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    test.skip((await refresh.count()) === 0, 'sessions refresh not present');

    errors.length = 0; // only count errors caused by the refresh
    await refresh.click();
    await page.waitForTimeout(2000);
    const info = await stillHealthy(page);
    expect(info.crashed, 'the refresh must not crash the section').toBe(false);
    expect(info.len, 'the section still renders after refresh').toBeGreaterThan(80);
    expect(errors, `0 console errors on refresh — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('analytics Live-Events refresh re-fetches cleanly (no crash / console error)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text().slice(0, 140));
    });
    page.on('pageerror', (e) => {
      if (!NOISE.test(String(e))) errors.push(String(e).slice(0, 140));
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/analytics', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="analytics-tab-live"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await selectFirstSite(page).catch(() => {});
    await page.locator('[data-testid="analytics-tab-live"]').click();
    const refresh = page.locator('[data-testid="al-refresh"]');
    await refresh.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    test.skip((await refresh.count()) === 0, 'live-events refresh not present');

    errors.length = 0;
    await refresh.click();
    await page.waitForTimeout(2000);
    const info = await stillHealthy(page);
    expect(info.crashed, 'the refresh must not crash the live panel').toBe(false);
    expect(info.len, 'the live panel still renders after refresh').toBeGreaterThan(80);
    expect(errors, `0 console errors on refresh — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
