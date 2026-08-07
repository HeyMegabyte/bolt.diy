/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — comprehensive Feature-Flags interaction
 * coverage, rounding out the section (search/filter=P0.65, copy-key=P0.67,
 * sentinel-protection=P0.72) with the REMAINING clickable surfaces per the mandate
 * ("every clickable / nav / modal / state has ≥1 E2E"):
 *   1. populated counters — the registry renders real flags + registered/on counts
 *   2. stage-filter tabs — selecting a stage narrows the grid to THAT stage only
 *   3. inspect — expands/collapses a per-flag detail panel
 *   4. cross-link nav — the "Features →" link routes to /admin/site-features
 *
 * All client-side (rendered from the loaded registry / router nav) → populated +
 * load-independent → robust (see [[admin-verify-e2e-authoring-gotchas]] #5).
 * Non-mutating (never toggles a flag). Real session (E2E_API_KEY).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./feature-flags-sentinel-protection.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const gotoFlags = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });
  await page.locator('.ff-card').first().waitFor({ state: 'visible', timeout: 15000 });
  // Wait for the full async registry to settle before any test interacts with the cards —
  // a mid-load count / first-card under 4-worker parallel prod load is the file's flake
  // class (gotcha 5). One poll here makes every test in the file load-robust.
  await expect.poll(() => page.locator('.ff-card').count(), { timeout: 8000 }).toBeGreaterThan(5);
};

test.describe('Admin · feature-flags interactions (P0-ADMIN)', () => {
  test('the registry populates with real flags + live registered/on counters', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoFlags(page);

    await expect(page.locator('[data-testid="ff-layer-heading"]')).toBeVisible();
    // A real registry — many flags, not an empty/stub state.
    expect(await page.locator('.ff-card').count(), 'the flag registry must be well-populated').toBeGreaterThan(5);
    // The header stats resolved (not stuck on the loading "…").
    const header = page.locator('.ff-sub');
    await expect(header).toContainText(/registered/i);
    await expect(header).toContainText(/on\./i);
    await expect(page.locator('.ff-stat-dots'), 'the counters must resolve, not stay loading').toHaveCount(0);
  });

  test('selecting a stage tab narrows the grid to that stage only, then "all" restores it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoFlags(page);

    const cards = page.locator('.ff-card');
    const total = await cards.count();

    // "stable" reliably has flags (core_* sentinels + shipped features).
    const stableTab = page.getByRole('tab', { name: /stable/i }).first();
    await stableTab.click();
    await expect(stableTab, 'the clicked stage tab is selected').toHaveAttribute('aria-selected', 'true');
    // Exclusive filter — no non-stable card remains rendered.
    await expect(
      page.locator('.ff-card:not([data-stage="stable"])'),
      'the grid must show ONLY stable-stage flags',
    ).toHaveCount(0, { timeout: 6000 });
    const stableCount = await cards.count();
    expect(stableCount, 'stable has at least one flag').toBeGreaterThan(0);
    expect(stableCount, 'a single stage is a subset of the full registry').toBeLessThanOrEqual(total);

    // "all" restores the full registry.
    await page.getByRole('tab', { name: /^all/i }).first().click();
    await expect(cards, 'selecting "all" restores every flag').toHaveCount(total, { timeout: 6000 });
  });

  test('Inspect expands then collapses a flag detail panel', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoFlags(page);

    const firstCard = page.locator('.ff-card').first();
    const inspect = firstCard.getByRole('button', { name: /^inspect/i });
    await inspect.click();
    await expect(inspect, 'Inspect marks itself expanded').toHaveAttribute('aria-expanded', 'true');
    await expect(firstCard.locator('.ff-detail'), 'Inspect reveals the detail panel').toBeVisible({ timeout: 6000 });

    await inspect.click();
    await expect(firstCard.locator('.ff-detail'), 'Inspect toggles the detail panel closed').toBeHidden({
      timeout: 6000,
    });
  });

  test('the "Features →" cross-link routes to /admin/site-features', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoFlags(page);

    const link = page.locator('[data-testid="ff-nav-site-features"]');
    await expect(link, 'the cross-link renders before we click it').toBeVisible();
    await link.click();
    // waitForURL is the canonical async-nav wait; 15s tolerates full-suite parallel prod load
    // (an 8s toHaveURL was the file's lone flake — self-healed on retry under lighter load).
    await page.waitForURL(/\/admin\/site-features/, { timeout: 15000 });
  });
});
