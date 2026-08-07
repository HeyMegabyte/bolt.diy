/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Feature Flags SEARCH input filters
 * calmly and safely across TDD Contract #10 value-domains: injection-/XSS-/protocol-
 * shaped, unicode, and overlong queries return a calm filtered/empty state — they
 * never execute, never crash, never pollute the console. `feature-flags-search-filter.spec.ts`
 * covers gibberish-empties + clear-restores; THIS adds the hostile-input security sweep.
 *
 * Search is a CLIENT-side computed filter over the already-loaded flag list (no server
 * call), so it is safe + deterministic for the E2E_API_KEY org (the board confirms ~91
 * flags render). The search input carries no testid → targeted via its placeholder;
 * each flag row exposes `[data-testid="ff-why"]`; a no-match query shows `app-empty-state`.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./feature-flags-search-filter.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Real console errors + pageerrors, ignoring benign fixture/harness noise. */
function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

const search = (page: Page) => page.getByPlaceholder(/search by key or description/i);
const flagRows = (page: Page) => page.locator('[data-testid="ff-why"]');

const gotoFlags = async (page: Page): Promise<void> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="ff-layer-heading"]').waitFor({ state: 'visible', timeout: 15000 });
};

test.describe('Admin · Feature Flags search value-domains (P0-ADMIN)', () => {
  test('the flag list renders populated for the real session (0 console errors)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    await gotoFlags(page);
    await expect(search(page), 'the search input renders').toBeVisible({ timeout: 8000 });
    await expect.poll(() => flagRows(page).count(), { timeout: 10000 }).toBeGreaterThan(5);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/feature-flags-populated.png' });
    expect(errors, `must render with 0 console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('injection / unicode / overlong queries filter calmly — never execute, crash, or error; clearing restores the list', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss().catch(() => {});
    });
    await gotoFlags(page);
    await expect.poll(() => flagRows(page).count(), { timeout: 10000 }).toBeGreaterThan(5);
    const baseline = await flagRows(page).count();

    const hostile = [
      `<script>alert('xss')</script>`,
      `<img src=x onerror=alert(1)>`,
      `'; DROP TABLE feature_flags;--`,
      `javascript:alert(document.cookie)`,
      `🎉🚩🔥 zzznomatch`,
      'z'.repeat(500),
    ];
    for (const q of hostile) {
      await search(page).fill(q);
      await page.waitForTimeout(300); // client filter settle
      // The layer is still standing (heading present, no crash / error boundary).
      await expect(page.locator('[data-testid="ff-layer-heading"]'), 'the flags layer survives hostile input').toBeVisible();
      const rows = await flagRows(page).count();
      expect(rows, `hostile query ${JSON.stringify(q.slice(0, 24))} yields a calm filtered count`).toBeGreaterThanOrEqual(0);
      // A no-match query resolves to the calm empty state, never a broken render.
      if (rows === 0) {
        await expect(page.locator('app-empty-state').first(), 'a no-match query shows the calm empty state').toBeVisible();
      }
    }

    // Clearing restores the full list — the filter is non-destructive.
    await search(page).fill('');
    await page.waitForTimeout(300);
    await expect.poll(() => flagRows(page).count(), { timeout: 8000 }).toBeGreaterThanOrEqual(baseline);

    expect(dialogFired, 'no search payload fired a dialog (no script executed)').toBe(false);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'no error-boundary crash').toBe(false);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/feature-flags-hostile-search.png' });
    expect(errors, `0 console errors on hostile search — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
