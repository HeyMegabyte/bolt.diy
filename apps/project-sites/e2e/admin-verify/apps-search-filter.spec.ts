/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Apps catalog SEARCH + FILTER interaction.
 *
 * A new interaction type for the admin-verify suite: a search box + lifecycle
 * filter chips over the client-side `APPS_CATALOG` (a static import). Filtering is
 * a signal-computed `filteredApps()` → INSTANT + LOAD-INDEPENDENT (no API refetch),
 * so the card-count assertions are robust under parallel prod throttling (see
 * [[admin-verify-e2e-authoring-gotchas]] gotcha 5 — the catalog renders even if the
 * install-counts/instances API is slow).
 *
 * Deterministic assertions only (no catalog-content knowledge): the catalog renders,
 * a gibberish query empties it, clearing restores the full count, and the lifecycle
 * chips narrow to a subset + restore. Real session (E2E_API_KEY) so /admin/apps mounts.
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · Apps — catalog search + lifecycle filter (P0-ADMIN)', () => {
  test('search: catalog renders, gibberish empties it, clearing restores the full count', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });

    const cards = page.locator('.app-card');
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });
    const full = await cards.count();
    expect(full, 'the static catalog must render a substantial number of app cards').toBeGreaterThanOrEqual(20);

    const search = page.locator('[data-testid="apps-search-input"]');

    // Gibberish → zero matches (the search actually filters the list).
    await search.fill('zqxq-no-app-matches-this-string-42');
    await expect(cards, 'a gibberish query must filter every card out').toHaveCount(0, { timeout: 6000 });

    // Clearing restores the full catalog (filter is non-destructive).
    await search.fill('');
    await expect(cards, 'clearing the search must restore the full catalog').toHaveCount(full, { timeout: 6000 });
  });

  test('lifecycle chips narrow to a subset + "All" restores the full catalog', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });

    const cards = page.locator('.app-card');
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });

    // Ensure we start from "All".
    await page.locator('[data-testid="apps-lifecycle-all"]').click();
    const full = await cards.count();
    expect(full).toBeGreaterThanOrEqual(20);

    // "Live" is a subset of the catalog (deployable-today apps) — ≤ full, and the
    // filter is a real narrowing (never MORE than the full set).
    await page.locator('[data-testid="apps-lifecycle-live"]').click();
    const live = await cards.count();
    expect(live, '"Live" must be a subset of the full catalog').toBeLessThanOrEqual(full);
    expect(live, '"Live" must show at least one deployable app').toBeGreaterThan(0);

    // Back to "All" → the full catalog returns.
    await page.locator('[data-testid="apps-lifecycle-all"]').click();
    await expect(cards, '"All" must restore the full catalog').toHaveCount(full, { timeout: 6000 });
  });
});
