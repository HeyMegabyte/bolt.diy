/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Feature Flags SEARCH + STAGE filter.
 *
 * The ~90 seeded flags render as `.ff-card` (each carries `[data-stage]`), filtered
 * client-side by a search box (`search()` signal) + stage pills (`stage()` signal).
 * Filtering is signal-computed `filtered()` → INSTANT + load-independent once the
 * flags load (they always do — ~90 seeded rows), so the count/stage assertions are
 * robust (see [[admin-verify-e2e-authoring-gotchas]]). `[data-stage]` lets us assert
 * the stage filter STRONGLY: every visible card matches the selected stage.
 *
 * Real session (E2E_API_KEY); `sections-populated` already confirms ≥10 flags render.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./apps-search-filter.spec.ts} — the sibling static-catalog search spec.
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · Feature Flags — search + stage filter (P0-ADMIN)', () => {
  test('search: flags render, gibberish empties the grid, clearing restores the full set', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });

    const cards = page.locator('.ff-card');
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });
    const full = await cards.count();
    expect(full, 'the seeded flag registry must render many flag cards').toBeGreaterThanOrEqual(10);

    const search = page.getByPlaceholder('Search by key or description…');

    // Gibberish → zero matches + the "No flags match this filter" empty state.
    await search.fill('zzqx-no-flag-matches-this-99');
    await expect(cards, 'a gibberish query must filter every flag out').toHaveCount(0, { timeout: 6000 });
    // The empty-filter state renders its "Clear filters" CTA (a unique, visible
    // affordance — "No flags match" text also appears in an sr-only status).
    await expect(
      page.getByRole('button', { name: /clear filters/i }),
      'the empty-filter state must render (with its Clear-filters CTA)',
    ).toBeVisible({ timeout: 6000 });

    // Clearing restores the full registry.
    await search.fill('');
    await expect(cards, 'clearing the search must restore all flags').toHaveCount(full, { timeout: 6000 });
  });

  test('stage pills filter to the selected stage; "All" restores the full set', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });

    const cards = page.locator('.ff-card');
    await cards.first().waitFor({ state: 'visible', timeout: 15000 });
    const full = await cards.count();
    expect(full).toBeGreaterThanOrEqual(10);

    // "experimental" is the launch-default stage → the largest bucket (has flags).
    await page.getByRole('tab', { name: /experimental/i }).click();
    const experimental = await cards.count();
    expect(experimental, 'the experimental stage must have flags').toBeGreaterThan(0);
    // STRONG assertion: every visible card is actually in the selected stage.
    await expect(
      page.locator('.ff-card:not([data-stage="experimental"])'),
      'no non-experimental card may show under the experimental filter',
    ).toHaveCount(0, { timeout: 6000 });
    expect(experimental, 'a stage filter is a subset of the full set').toBeLessThanOrEqual(full);

    // "All" restores the full registry.
    await page.getByRole('tab', { name: /^all/i }).click();
    await expect(cards, '"All" must restore every flag').toHaveCount(full, { timeout: 6000 });
  });
});
