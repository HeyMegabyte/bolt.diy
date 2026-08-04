/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin dashboard "Getting Started" hub
 * search/filter, a shell-level, org-data-INDEPENDENT surface (the section-card
 * registry is static): typing narrows the cards live into a "N results" group, a
 * no-result query shows an honest empty state echoing the query, and Clear resets.
 * A genuine filter interaction (blueprint Group C — sort/filter).
 *
 * NON-MUTATING: only types into the hub search box + clicks Clear (✕) — no write, no
 * navigation, no pin toggle. `filtered()` is a pure client `computed()` over the
 * static card registry, so this passes for any org (populated or empty).
 *
 * @see {@link ./command-palette-lifecycle.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openHub = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  // The hub search input renders once the dashboard section mounts — a reliable
  // readiness signal (and the surface under test).
  await page.locator('[data-testid="dash-search"]').waitFor({ state: 'visible', timeout: 20000 });
};

test.describe('Admin · dashboard hub search / filter (P0-ADMIN)', () => {
  test('typing a matching term filters the hub into a "results" group (no no-match)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openHub(page);

    const search = page.locator('[data-testid="dash-search"]');
    await search.pressSequentially('settings', { delay: 25 });
    await expect(search, 'the hub search holds the typed query').toHaveValue('settings');
    // A real admin term matches → the flat "Search results" group renders and the
    // no-match empty state must NOT appear.
    await expect(
      page.locator('section[aria-label="Search results"]'),
      '"settings" matches → a results group renders',
    ).toBeVisible({ timeout: 4000 });
    await expect(page.locator('[data-testid="dash-no-match"]'), 'a matching query shows no no-match state').toHaveCount(0);
  });

  test('a gibberish query shows the honest no-match empty state echoing the query', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openHub(page);

    await page.locator('[data-testid="dash-search"]').pressSequentially('zzqqwxplnomatch', { delay: 20 });
    const noMatch = page.locator('[data-testid="dash-no-match"]');
    await expect(noMatch, 'a no-result query shows the no-match state').toBeVisible({ timeout: 4000 });
    await expect(noMatch, 'the no-match state echoes the query back').toContainText('zzqqwxplnomatch');
  });

  test('the Clear (✕) button resets the search and dismisses the no-match state', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openHub(page);

    const search = page.locator('[data-testid="dash-search"]');
    await search.pressSequentially('zzqqwxplnomatch', { delay: 20 });
    await expect(page.locator('[data-testid="dash-no-match"]')).toBeVisible({ timeout: 4000 });

    await page.locator('[data-testid="dash-search-clear"]').click();
    await expect(search, 'Clear empties the search input').toHaveValue('');
    await expect(page.locator('[data-testid="dash-no-match"]'), 'Clear dismisses the no-match state').toHaveCount(0);
  });
});
