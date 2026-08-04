/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — App detail page (`/admin/apps/:id`).
 * Navigate from the catalog (a REAL app id, no hardcode) → detail renders with the
 * deploy control PRESENT (never clicked — deploy provisions real infra). An unknown
 * id shows a not-found state. Enumerated read-only (directive #1); see
 * [[admin-verify-e2e-authoring-gotchas]] #5.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./apps-search-filter.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · App detail (P0-ADMIN)', () => {
  test('a catalog card opens its detail page (real id) with a deploy control, not 404', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });

    const firstCard = page.locator('.app-card').first();
    await firstCard.waitFor({ state: 'visible', timeout: 15000 });
    await firstCard.click();

    // Landed on a real /admin/apps/<id> detail route.
    await expect(page, 'clicking a card navigates to its detail').toHaveURL(/\/admin\/apps\/[a-z0-9-]+/, {
      timeout: 8000,
    });
    // The app title renders (h2 with the app name).
    await expect(page.locator('h2').first(), 'the app title renders').toBeVisible({ timeout: 8000 });
    // A deploy affordance is present — asserted, NEVER clicked (it provisions infra).
    await expect(
      page.locator('[data-testid="apps-deploy-cta"], [data-testid="apps-deploy-soon"]').first(),
      'a deploy affordance is present',
    ).toBeVisible({ timeout: 8000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
  });

  test('an unknown app id shows a not-found state (not a blank crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps/zzz-not-a-real-app-42', { waitUntil: 'domcontentloaded' });
    await page
      .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 60, { timeout: 12000 })
      .catch(() => {});
    // A "not found" / "doesn't exist" message renders (either the app-detail's own
    // notice or the admin not-found) — never a blank/crashed page.
    await expect(page.getByText(/not found|doesn't exist|no app|unknown/i).first(), 'a not-found state renders').toBeVisible(
      { timeout: 8000 },
    );
  });
});
