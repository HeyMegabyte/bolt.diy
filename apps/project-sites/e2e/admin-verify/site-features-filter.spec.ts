/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin/site-features catalog READ-ONLY
 * interactions: the search filters the 14-feature catalog live (with an honest
 * no-match state), and the per-feature Preview toggle reveals/hides a preview panel.
 *
 * NON-MUTATING: only `sf-search` (client `search()` signal) + `sf-preview`
 * (`previewKey()` signal) — NEVER `sf-toggle` (which POSTs to enable a site feature).
 * SITE-SCOPED (Features layer is per-project + plan-aware) → `selectFirstSite`; skips
 * honestly if the section doesn't surface the catalog for this org.
 *
 * @see {@link ../helpers/site-context.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const openSiteFeatures = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/site-features', { waitUntil: 'domcontentloaded' });
  await selectFirstSite(page).catch(() => false);
  await page.locator('[data-testid="sf-search"]').waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  return (await page.locator('[data-testid="sf-search"]').count()) > 0;
};

test.describe('Admin · site-features catalog filter + preview (P0-ADMIN)', () => {
  test('the search filters the feature catalog to a no-match state and back', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openSiteFeatures(page)), 'site-features catalog not surfaced for this org');

    const cards = page.locator('.sf-card');
    expect(await cards.count(), 'the feature catalog renders cards').toBeGreaterThan(0);

    await page.locator('[data-testid="sf-search"]').pressSequentially('zzqqnofeature', { delay: 20 });
    await expect(cards, 'a no-match query hides every feature').toHaveCount(0);
    await expect(page.locator('[data-testid="sf-empty"]'), 'the no-match empty state appears').toBeVisible({
      timeout: 4000,
    });

    await page.locator('[data-testid="sf-search"]').fill('');
    await expect(cards.first(), 'clearing the search restores the catalog').toBeVisible({ timeout: 4000 });
  });

  test('the Preview toggle reveals + hides a feature preview panel (aria-pressed)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    test.skip(!(await openSiteFeatures(page)), 'site-features catalog not surfaced for this org');

    const preview = page.locator('[data-testid="sf-preview"]').first();
    await expect(preview, 'a Preview button renders').toBeVisible({ timeout: 8000 });
    await expect(preview, 'preview starts unpressed').toHaveAttribute('aria-pressed', 'false');

    await preview.click();
    await expect(preview, 'clicking presses Preview').toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid="sf-preview-panel"]').first(), 'the preview panel reveals').toBeVisible({
      timeout: 4000,
    });

    await preview.click();
    await expect(preview, 'clicking again unpresses Preview').toHaveAttribute('aria-pressed', 'false');
  });
});
