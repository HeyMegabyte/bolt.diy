/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the /admin/apps/:id detail PAGER: Next/Prev
 * navigate between adjacent app details (the pager wraps around `APPS_CATALOG`, so both
 * always render), and an AI-recommendation card routes to another app. Pure routerLink
 * navigation over the static catalog — org-independent.
 *
 * NON-MUTATING: only routerLink navigation (pager + recommendation) — NEVER clicks the
 * deploy CTA (`apps-deploy-cta`). Prev-from-the-Next-page returns to the start (the
 * pager is symmetric/adjacent).
 *
 * @see {@link ./apps-card-detail-nav.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openFirstAppDetail = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/apps', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="apps-lifecycle-all"]').waitFor({ state: 'visible', timeout: 20000 });
  const card = page.locator('[data-testid^="apps-card-"]').first();
  await card.waitFor({ state: 'visible', timeout: 8000 });
  await card.click();
  await page.locator('[data-testid="apps-pager"]').waitFor({ state: 'visible', timeout: 10000 });
};

test.describe('Admin · apps detail pager navigation (P0-ADMIN)', () => {
  test('the pager Next → Prev round-trips between adjacent app details', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openFirstAppDetail(page);

    const startPath = new URL(page.url()).pathname; // /admin/apps/{A}
    await page.locator('[data-testid^="apps-next-"]').first().click();
    await page
      .waitForFunction(
        (p) => location.pathname !== p && location.pathname.startsWith('/admin/apps/'),
        startPath,
        { timeout: 8000 },
      )
      .catch(() => {});
    const nextPath = new URL(page.url()).pathname;
    expect(nextPath, 'Next navigates to a different app detail').not.toBe(startPath);

    // Prev from the Next page returns to the start (adjacent + symmetric).
    await page.locator('[data-testid="apps-pager"]').waitFor({ state: 'visible', timeout: 8000 });
    await page.locator('[data-testid^="apps-prev-"]').first().click();
    await page.waitForFunction((p) => location.pathname === p, startPath, { timeout: 8000 }).catch(() => {});
    expect(new URL(page.url()).pathname, 'Prev returns to the starting app detail').toBe(startPath);
  });

  test('an AI-recommendation card routes to another app detail', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openFirstAppDetail(page);

    const rec = page.locator('[data-testid^="apps-rec-"]').first();
    if ((await rec.count()) === 0) {
      test.skip(true, 'this app has no AI recommendations to navigate to');
      return;
    }
    const startPath = new URL(page.url()).pathname;
    await rec.click();
    await page
      .waitForFunction(
        (p) => location.pathname !== p && location.pathname.startsWith('/admin/apps/'),
        startPath,
        { timeout: 8000 },
      )
      .catch(() => {});
    expect(new URL(page.url()).pathname, 'a recommendation opens a different app detail').not.toBe(startPath);
    await expect(page.locator('a.back-link').first(), 'the recommended app detail renders').toBeVisible({ timeout: 8000 });
  });
});
