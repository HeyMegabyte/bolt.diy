/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the Getting-Started hub (the DEFAULT
 * `/admin` route, `dashboard.component`). Coverage gap closed this fire: the shell
 * had a nav spec (admin-nav-shell) but the hub's own interactive surface — the
 * section search + the section-guide cards — had no admin-verify E2E.
 *
 * Enumerated read-only (directive #1). Gates are org-agnostic (E2E_API_KEY ≠
 * brian's org, gotcha #4) — assert the search FILTERS + CLEARS and that a section
 * card NAVIGATES, not any account-specific numbers. Non-mutating (pin toggles are
 * localStorage-only and not exercised destructively).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./admin-nav-shell.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="dash-search"]').waitFor({ state: 'visible', timeout: 15000 });
};

test.describe('Admin · Getting-Started hub (P0-ADMIN)', () => {
  test('the hub renders the section search + a grid of section-guide cards', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin');

    await expect(page.locator('[data-testid="dash-search"]'), 'the section search renders').toBeVisible();
    // The section guide links out to real admin routes — several must render.
    const sectionLinks = page.locator('a[href^="/admin/"]');
    expect(
      await sectionLinks.count(),
      'the hub surfaces multiple section links',
    ).toBeGreaterThan(3);
  });

  test('typing a non-matching query shows the no-match state, and clearing restores the cards', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);

    const search = page.locator('[data-testid="dash-search"]');
    await search.fill('zzzqqq-nothing-matches-this');
    // The filter runs client-side → the "no sections match" card appears.
    await expect(page.locator('[data-testid="dash-no-match"]'), 'a no-match empty state shows').toBeVisible({
      timeout: 6000,
    });

    // Clearing from the empty-state card restores the section grid.
    await page.locator('[data-testid="dash-no-match-clear"]').click();
    await expect(page.locator('[data-testid="dash-no-match"]'), 'the no-match card clears').toBeHidden({
      timeout: 6000,
    });
    await expect(search, 'the search input is emptied').toHaveValue('');
    expect(await page.locator('a[href^="/admin/"]').count(), 'section links return after clearing').toBeGreaterThan(
      3,
    );
  });

  test('a section-guide card navigates to its admin route', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);

    // The helpful-links "API docs" entry is a stable routerLink to /admin/docs.
    const docs = page.locator('a[href="/admin/docs"]').first();
    await expect(docs, 'a docs link is present on the hub').toBeVisible({ timeout: 8000 });
    await docs.click();
    await page
      .waitForFunction(() => location.pathname === '/admin/docs', undefined, { timeout: 10000 })
      .catch(() => {});
    expect(new URL(page.url()).pathname, 'clicking the card navigates to /admin/docs').toBe('/admin/docs');
  });
});
