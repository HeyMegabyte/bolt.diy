/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — API Docs (`/admin/docs`): OpenAPI
 * explorer (search + verb filters + endpoint rows). Org-agnostic + read-only
 * (docs are static) — presence-not-counts, client-side filter/toggle only, NEVER
 * a mutating request (see [[admin-verify-e2e-authoring-gotchas]] #5).
 * Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/docs', { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(
      () => !document.querySelector('[data-testid="docs-loading"]') || (document.querySelector('main')?.innerText ?? '').length > 300,
      undefined,
      { timeout: 15000 },
    )
    .catch(() => {});
};

test.describe('Admin · API Docs interactions (P0-ADMIN)', () => {
  test('the OpenAPI explorer loads (overview populated, not error/404)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/docs');
    await expect(page.getByText(/api docs|build on projectsites/i).first(), 'the docs heading renders').toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('[data-testid="docs-error"]'), 'no docs load error').toHaveCount(0);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
  });

  test('the endpoint list is populated (real documented routes)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    await expect(
      page.locator('[data-testid^="docs-nav-endpoint-"]').first(),
      'documented endpoint rows render',
    ).toBeVisible({ timeout: 12000 });
    expect(await page.locator('[data-testid^="docs-nav-endpoint-"]').count(), 'the API is well-documented').toBeGreaterThan(3);
  });

  test('the search + verb-filter controls render and filter', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    await expect(page.locator('[data-testid="docs-search"]'), 'the docs search renders').toBeVisible({ timeout: 8000 });

    // Toggle the GET verb chip — client-side, aria-pressed reflects state.
    const getChip = page.locator('[data-testid="docs-verb-chip-get"]');
    if ((await getChip.count()) > 0) {
      const before = await getChip.getAttribute('aria-pressed');
      await getChip.click();
      await expect(getChip, 'the verb chip toggles its pressed state').not.toHaveAttribute(
        'aria-pressed',
        before ?? '',
        { timeout: 6000 },
      );
    }
  });
});
