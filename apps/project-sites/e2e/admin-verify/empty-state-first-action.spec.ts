/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the empty-state "first action" affordances
 * WORK (the CTA inside an honest empty state opens the right modal / navigates the
 * right route). These are the conversion paths from an empty section → first use.
 *
 * NON-MUTATING: opens a modal (then Escape) / navigates — NEVER submits.
 *
 * @see {@link ./admin-modal-lifecycle.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

test.describe('Admin · empty-state first-action affordances (P0-ADMIN)', () => {
  test('API tokens: the empty "Create your first token" CTA opens the create modal', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/api-tokens', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="at-create-open"]').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500); // let the tokens list resolve (empty vs populated)

    const emptyCta = page.getByRole('button', { name: /create your first token/i });
    if ((await emptyCta.count()) === 0) {
      test.skip(true, 'org already has tokens — empty-state CTA not shown');
      return;
    }
    await emptyCta.first().click();
    await expect(page.locator('[role="dialog"]'), 'the empty CTA opens the create modal').toBeVisible({
      timeout: 6000,
    });
    await page.keyboard.press('Escape'); // close without creating
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 6000 });
  });

  test('App instances: the empty "Browse the app store" CTA navigates to the catalog', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/apps/instances', { waitUntil: 'domcontentloaded' });
    // Wait for the instances fetch to settle (rows OR the empty state).
    await page
      .waitForFunction(
        () =>
          !!document.querySelector('[data-testid^="apps-instance-"]') ||
          /no app instances/i.test(document.body.innerText || ''),
        undefined,
        { timeout: 15000 },
      )
      .catch(() => {});

    const browse = page.getByRole('button', { name: /browse the app store/i }).first();
    if ((await browse.count()) === 0) {
      test.skip(true, 'org has app instances — empty-state Browse CTA not shown');
      return;
    }
    await browse.click();
    await page
      .waitForFunction(() => location.pathname === '/admin/apps', undefined, { timeout: 8000 })
      .catch(() => {});
    expect(new URL(page.url()).pathname, 'Browse navigates to the apps catalog').toBe('/admin/apps');
  });
});
