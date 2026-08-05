/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the MOBILE navigation flow (375px): the
 * hamburger opens the overlay nav drawer, the ✕ closes it, and tapping a nav link
 * navigates + auto-closes the drawer. A genuine mobile-UX path the desktop specs can't
 * cover (the sidebar is a fixed overlay drawer below the md breakpoint).
 *
 * Selectors discovered via a real 375px probe (not guessed): the opener is
 * `[aria-label="Open navigation menu"]` (no testid), the close is
 * `[data-testid="admin-sidebar-mobile-close"]`, drawer nav links carry `nav-*` testids,
 * and admin.component auto-closes the drawer after navigation.
 *
 * NON-MUTATING: open/close + one in-app navigation. No write.
 *
 * @see {@link ./admin-keyboard-shortcuts.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const OPEN = '[aria-label="Open navigation menu"]';
const CLOSE = '[data-testid="admin-sidebar-mobile-close"]';

const openAdminMobile = async (page: import('@playwright/test').Page) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="dash-search"]').waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.locator(OPEN).first().waitFor({ state: 'visible', timeout: 10000 });
};

test.describe('Admin · mobile navigation drawer (375px) (P0-ADMIN)', () => {
  test('the hamburger opens the nav drawer and the ✕ closes it', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openAdminMobile(page);

    await expect(page.locator(CLOSE), 'the drawer starts closed').toHaveCount(0);
    await page.locator(OPEN).first().click();
    await expect(page.locator(CLOSE), 'the hamburger opens the drawer (✕ appears)').toBeVisible({ timeout: 6000 });
    await expect(page.locator('[data-testid="nav-features"]'), 'nav links are visible in the open drawer').toBeVisible();

    // The ✕ is a <button aria-label="Close navigation menu"> INSIDE the
    // `admin-sidebar-mobile-close` wrapper div — click the button, not the wrapper.
    await page.locator('[aria-label="Close navigation menu"]').first().click();
    await expect(page.locator(CLOSE), 'the ✕ closes the drawer').toBeHidden({ timeout: 6000 });
  });

  test('tapping a nav link navigates and auto-closes the drawer', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
    await openAdminMobile(page);

    await page.locator(OPEN).first().click();
    const navLink = page.locator('[data-testid="nav-features"]');
    await expect(navLink).toBeVisible({ timeout: 6000 });
    await navLink.click();

    // Navigation happened (left /admin) AND the overlay drawer auto-closed.
    await page.waitForFunction(() => location.pathname !== '/admin', undefined, { timeout: 8000 }).catch(() => {});
    expect(new URL(page.url()).pathname, 'the nav link navigated away from the hub').not.toBe('/admin');
    await expect(page.locator(CLOSE), 'the drawer auto-closed after navigation').toBeHidden({ timeout: 6000 });
  });
});
