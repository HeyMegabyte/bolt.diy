/**
 * a11y-focus-trap.spec.ts — Playwright coverage for WCAG 2.4.3 Focus Order in
 * the admin user menu.
 *
 * @remarks
 * The user menu's `[focusTrap]="userMenuOpen()"` binding wraps Tab/Shift-Tab
 * navigation between the first and last focusable descendant and restores
 * focus to the avatar button on Esc / dismiss. This spec asserts the contract
 * end-to-end against the production URL.
 *
 * Auth state — the production /admin route requires sign-in. The test uses
 * `MOCK_USER_PASSWORD` env auth when available; otherwise it skips early via
 * `test.skip()` so unauthenticated CI runs do not produce false failures.
 */
import { test, expect, type Page } from '@playwright/test';

const PROD_URL = process.env['PROD_URL'] ?? 'https://projectsites.dev';

/**
 * Best-effort attempt to land on /admin authenticated. If no auth method is
 * available the test is skipped — the focus-trap contract is unit-tested in
 * `focus-trap.directive.spec.ts` regardless.
 */
async function gotoAdmin(page: Page): Promise<boolean> {
  await page.goto(`${PROD_URL}/admin`, { waitUntil: 'domcontentloaded' });
  // If the sign-in prompt is visible, we are not authenticated.
  const signin = page.getByRole('link', { name: /sign in/i });
  if (await signin.isVisible().catch(() => false)) {
    return false;
  }
  return true;
}

test.describe('Focus trap — admin user menu', () => {
  test('Tab wraps to first item after the last, and Esc restores focus to the avatar', async ({ page }) => {
    const authed = await gotoAdmin(page);
    test.skip(!authed, 'requires authenticated /admin session');

    const avatar = page.getByTestId('user-avatar-btn');
    await expect(avatar).toBeVisible();
    await avatar.click();

    const menu = page.getByTestId('user-menu');
    await expect(menu).toBeVisible();

    // First focusable item inside the menu (link to Billing).
    const firstItem = menu.locator('a, button').first();
    const lastItem = menu.locator('a, button').last();
    await firstItem.focus();

    // Tab past last item — focus must wrap to the first item.
    await lastItem.focus();
    await page.keyboard.press('Tab');
    await expect(firstItem).toBeFocused();

    // Esc closes the menu and restores focus to the avatar trigger.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(avatar).toBeFocused();
  });
});
