/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — clicking an /admin/apps catalog card
 * navigates to that app's detail route (/admin/apps/:id), the detail renders (not the
 * "App not found" fallback), and the Back link returns to the catalog. Pure routerLink
 * navigation over the static APPS_CATALOG — org-independent.
 *
 * NON-MUTATING: only routerLink navigation (card → detail → back) — NEVER clicks the
 * deploy CTA (`apps-deploy-cta`), which would install/deploy the app.
 *
 * @see {@link ./apps-catalog-filter.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openApps = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="apps-lifecycle-all"]').waitFor({ state: 'visible', timeout: 20000 });
};

test.describe('Admin · apps card → detail navigation (P0-ADMIN)', () => {
  test('clicking a catalog card opens its detail route; Back returns to the catalog', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openApps(page);

    const firstCard = page.locator('[data-testid^="apps-card-"]').first();
    await expect(firstCard, 'the catalog renders app cards').toBeVisible({ timeout: 8000 });
    const testid = (await firstCard.getAttribute('data-testid')) ?? '';
    const appId = testid.replace('apps-card-', '');
    expect(appId, 'a catalog card carries an app id').not.toEqual('');

    await firstCard.click();
    await page.waitForFunction((id) => location.pathname === `/admin/apps/${id}`, appId, { timeout: 8000 });
    expect(new URL(page.url()).pathname, 'the card navigates to its detail route').toBe(`/admin/apps/${appId}`);
    // The detail rendered — the always-present Back link is visible AND it is not the
    // "App not found" fallback (i.e. a real catalog app resolved).
    await expect(page.locator('a.back-link').first(), 'the app detail shell renders').toBeVisible({ timeout: 8000 });
    await expect(page.getByText('App not found'), 'a real catalog app resolved (not the 404 state)').toHaveCount(0);

    // Back link returns to the catalog.
    await page.locator('a.back-link').first().click();
    await page.waitForFunction(() => location.pathname === '/admin/apps', undefined, { timeout: 8000 });
    await expect(page.locator('[data-testid="apps-lifecycle-all"]'), 'the catalog is shown again').toBeVisible({
      timeout: 8000,
    });
  });
});
