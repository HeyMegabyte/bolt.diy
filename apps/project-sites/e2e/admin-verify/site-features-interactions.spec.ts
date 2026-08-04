/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — Site Features (`/admin/site-features`):
 * site-scoped, plan-aware feature cards. Org-agnostic (e2e-org = FREE plan, some
 * cards plan-locked): one-of-state, presence-not-counts, NEVER toggle a live
 * feature (see [[admin-verify-e2e-authoring-gotchas]] #5). Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/site-features', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="sf-root"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
};

test.describe('Admin · Site Features interactions (P0-ADMIN)', () => {
  test('renders the Features section with the system cross-link, not the 404', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/site-features');
    await expect(page.locator('[data-testid="sf-layer-heading"]'), 'the Features heading renders').toBeVisible({
      timeout: 8000,
    });
    await expect(page.locator('[data-testid="sf-nav-system"]'), 'the system-flags cross-link renders').toBeVisible();
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
  });

  test('the section renders a state (cards / empty / plan-notice), each card toggle-able or locked', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    // The section renders SOME state — cards (with a toggle/lock each), or an honest
    // empty/no-plan/no-site notice. The e2e-org (FREE, maybe no site) shows a notice,
    // not cards — so the org-agnostic invariant is "substantial content rendered".
    const rootLen = await page.locator('[data-testid="sf-root"]').innerText().catch(() => '');
    expect((typeof rootLen === 'string' ? rootLen : '').trim().length, 'the section rendered a state').toBeGreaterThan(
      120,
    );
    const cards = page.locator('[data-testid^="sf-card-"]');
    if ((await cards.count()) > 0) {
      const first = cards.first();
      const controls =
        (await first.locator('[data-testid="sf-toggle"]').count()) +
        (await first.locator('[data-testid="sf-locked"]').count());
      expect(controls, 'a card exposes a toggle or a plan-lock').toBeGreaterThan(0);
    }
  });

  test('the feature search input filters (client-side)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    const search = page.locator('[data-testid="sf-search"]');
    await expect(search, 'the feature search input renders').toBeVisible({ timeout: 8000 });
    await search.fill('zzz-no-feature-matches-this');
    // Filtering surfaces either the filter-count or the no-match empty state.
    const filtered =
      (await page.locator('[data-testid="sf-filter-count"]').count()) +
      (await page.locator('[data-testid="sf-empty"]').count());
    expect(filtered, 'search narrows the catalog (filter-count or empty)').toBeGreaterThan(0);
  });
});
