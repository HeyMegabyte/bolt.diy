/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin Apps store catalog filters, a
 * shell-level, org-data-INDEPENDENT surface (`APPS_CATALOG` is a static curated
 * list): the lifecycle tab strip (All / Live / Soon) switches with aria-selected,
 * the search box narrows the catalog live (down to an honest empty state), and the
 * category filter menu opens/closes with aria-expanded.
 *
 * NON-MUTATING: typing into search + clicking tabs/menu are pure client-side view
 * filters over the static catalog — no install, no /api write. Passes for any org.
 *
 * @see {@link ./dashboard-hub-search.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openApps = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="apps-lifecycle-all"]').waitFor({ state: 'visible', timeout: 20000 });
};

test.describe('Admin · apps catalog filters (P0-ADMIN)', () => {
  test('the lifecycle tabs (All / Live / Soon) switch with aria-selected', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openApps(page);

    const all = page.locator('[data-testid="apps-lifecycle-all"]');
    const live = page.locator('[data-testid="apps-lifecycle-live"]');
    const soon = page.locator('[data-testid="apps-lifecycle-soon"]');
    await expect(all, 'All is selected by default').toHaveAttribute('aria-selected', 'true');

    await live.click();
    await expect(live, 'Live becomes selected').toHaveAttribute('aria-selected', 'true');
    await expect(all, 'All deselects').toHaveAttribute('aria-selected', 'false');

    await soon.click();
    await expect(soon, 'Soon becomes selected').toHaveAttribute('aria-selected', 'true');
    await expect(live, 'Live deselects').toHaveAttribute('aria-selected', 'false');
  });

  test('the search box filters the catalog down to an empty state (non-mutating)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openApps(page);

    const cards = page.locator('.app-card');
    await expect(cards.first(), 'the catalog renders app cards').toBeVisible({ timeout: 8000 });
    const search = page.locator('[data-testid="apps-search-input"]');

    await search.pressSequentially('zzqqnomatchapp', { delay: 20 });
    await expect(cards, 'a no-match query empties the catalog').toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Clear filters' }),
      'the empty state offers a Clear-filters action',
    ).toBeVisible({ timeout: 4000 });

    await search.fill('');
    await expect(cards.first(), 'clearing the search restores the catalog').toBeVisible({ timeout: 4000 });
  });

  test('the category filter menu opens (aria-expanded) and Escape closes it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openApps(page);

    const trigger = page.locator('[data-testid="apps-category-filter"]');
    await expect(trigger, 'the category filter starts collapsed').toHaveAttribute('aria-expanded', 'false');

    await trigger.click();
    await expect(trigger, 'clicking expands it').toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-testid="apps-category-menu"]'), 'the category menu opens').toBeVisible({
      timeout: 4000,
    });

    // When open, a full-screen `cat-backdrop` covers the trigger — the intended close
    // paths are the backdrop or Escape (window:keydown), NOT re-clicking the trigger.
    await page.keyboard.press('Escape');
    await expect(trigger, 'Escape collapses it').toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-testid="apps-category-menu"]'), 'the menu closes').toBeHidden({ timeout: 4000 });
  });
});
