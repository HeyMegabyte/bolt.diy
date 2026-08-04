/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Apps catalog CATEGORY multi-select
 * filter + the Escape-clears-search KEYBOARD interaction.
 *
 * Both operate on the static client-side `APPS_CATALOG` via signal-computed
 * `filteredApps()` → INSTANT + load-independent → robust under parallel prod load
 * (see [[admin-verify-e2e-authoring-gotchas]]). Complements apps-search-filter.spec
 * (search box + lifecycle chips) with the category menu + a keyboard affordance.
 *
 * Real session (E2E_API_KEY) so /admin/apps mounts authed.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./apps-search-filter.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · Apps — category filter + keyboard (P0-ADMIN)', () => {
  test('category menu: selecting a category narrows the catalog; Clear restores it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });

    const cards = page.locator('.app-card');
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });
    const full = await cards.count();
    expect(full).toBeGreaterThanOrEqual(20);

    // Open the category menu.
    await page.locator('[data-testid="apps-category-filter"]').click();
    await expect(page.locator('[data-testid="apps-category-menu"]'), 'the category menu must open').toBeVisible({
      timeout: 6000,
    });

    // Select the first category → the catalog narrows to that category's apps.
    await page.locator('[data-testid^="apps-category-opt-"]').first().check();

    // Selection registered → the "Clear (N)" affordance appears.
    await expect(
      page.locator('[data-testid="apps-category-clear"]'),
      'selecting a category must surface the Clear affordance',
    ).toBeVisible({ timeout: 6000 });

    const narrowed = await cards.count();
    expect(narrowed, 'a single category is a strict subset of the full catalog').toBeLessThan(full);
    expect(narrowed, 'the selected category must have at least one app').toBeGreaterThan(0);

    // Clear → the full catalog returns.
    await page.locator('[data-testid="apps-category-clear"]').click();
    await expect(cards, 'clearing the category must restore the full catalog').toHaveCount(full, { timeout: 6000 });
  });

  test('Escape in the search box clears it + restores the full catalog', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });

    const cards = page.locator('.app-card');
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });
    const full = await cards.count();

    const search = page.locator('[data-testid="apps-search-input"]');
    await search.fill('zqxq-no-app-matches-this-string-42');
    await expect(cards, 'gibberish narrows the catalog to zero').toHaveCount(0, { timeout: 6000 });

    // Escape (while the search is focused) clears it — the catalog returns.
    await search.press('Escape');
    await expect(search, 'Escape must clear the search input').toHaveValue('', { timeout: 6000 });
    await expect(cards, 'Escape-clearing the search must restore the full catalog').toHaveCount(full, {
      timeout: 6000,
    });
  });
});
