/**
 * E2E tests for the header user dropdown menu.
 *
 * Verifies:
 * - Dropdown trigger appears when logged in
 * - Clicking trigger opens dropdown with all items
 * - Dashboard, Manage Billing, Sign Out items exist and are clickable
 * - Clicking outside closes dropdown
 * - Sign Out clears session and shows Sign In button
 * - Dropdown is not clipped (fully visible)
 */
import { test, expect } from './fixtures';

test.describe('Header dropdown menu', () => {
  test('shows Sign In button when not authenticated', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const signinBtn = page.locator('.header-btn-signin');
    await expect(signinBtn).toBeVisible({ timeout: 5_000 });
    await expect(signinBtn).toContainText('Sign In');
  });

  test('does not show user menu trigger when not authenticated', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).not.toBeVisible();
  });

  test('shows user menu trigger with email when authenticated', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await expect(trigger).toContainText('test@example.com');
  });

  test('opens dropdown on trigger click with all menu items', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    // All three menu items should be visible
    const dashboard = page.getByTestId('menu-dashboard');
    const billing = page.getByTestId('menu-billing');
    const signout = page.getByTestId('menu-signout');

    await expect(dashboard).toBeVisible({ timeout: 3_000 });
    await expect(billing).toBeVisible();
    await expect(signout).toBeVisible();

    // Verify text content
    await expect(dashboard).toContainText('Dashboard');
    await expect(billing).toContainText('Manage Billing');
    await expect(signout).toContainText('Sign Out');
  });

  test('dropdown is not clipped and fully visible', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    const dropdown = page.locator('.user-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    // Verify the dropdown is within the viewport (not clipped)
    const box = await dropdown.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(50);
    expect(box!.width).toBeGreaterThan(100);

    // Verify the Sign Out button (last item) is also in the viewport
    const signout = page.getByTestId('menu-signout');
    const signoutBox = await signout.boundingBox();
    expect(signoutBox).not.toBeNull();

    const viewport = page.viewportSize();
    expect(signoutBox!.y + signoutBox!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('dropdown has a divider between billing and sign out', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    const divider = page.locator('.user-dropdown .dropdown-divider');
    await expect(divider).toBeVisible({ timeout: 3_000 });
  });

  test('chevron rotates when dropdown is open', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });

    const chevron = page.locator('.chevron');
    // Chevron should not have 'open' class initially
    await expect(chevron).not.toHaveClass(/open/);

    await trigger.click();

    // Chevron should have 'open' class when dropdown is open
    await expect(chevron).toHaveClass(/open/);
  });

  test('clicking Dashboard navigates to /admin', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    const dashboard = page.getByTestId('menu-dashboard');
    await expect(dashboard).toBeVisible({ timeout: 3_000 });
    await dashboard.click();

    await page.waitForURL('**/admin', { timeout: 5_000 });
    expect(page.url()).toContain('/admin');
  });

  test('clicking Sign Out clears session and shows Sign In button', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    const signout = page.getByTestId('menu-signout');
    await expect(signout).toBeVisible({ timeout: 3_000 });
    await signout.click();

    // Should navigate to homepage and show Sign In button
    await page.waitForURL('**/', { timeout: 5_000 });
    const signinBtn = page.locator('.header-btn-signin');
    await expect(signinBtn).toBeVisible({ timeout: 5_000 });

    // Session should be cleared from localStorage
    const session = await page.evaluate(() => localStorage.getItem('ps_session'));
    expect(session).toBeNull();
  });

  test('clicking outside the dropdown closes it', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    const dropdown = page.locator('.user-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    // Click on the page body outside the dropdown
    await page.locator('main.app').click({ position: { x: 50, y: 200 } });

    await expect(dropdown).not.toBeVisible({ timeout: 3_000 });
  });

  test('dropdown is not occluded by ion-toolbar shadow DOM overflow', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });
    await trigger.click();

    const dropdown = page.locator('.user-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    // Take screenshot for visual verification
    await page.screenshot({ path: 'e2e/screenshots/dropdown-open.png' });

    // Check that no ancestor shadow DOM element clips the dropdown via overflow:hidden
    const analysis = await page.evaluate(() => {
      const toolbar = document.querySelector('ion-toolbar');
      const header = document.querySelector('ion-header');
      const clippingElements: string[] = [];

      if (toolbar?.shadowRoot) {
        for (const el of toolbar.shadowRoot.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          if (s.overflow === 'hidden') {
            clippingElements.push(`toolbar-shadow: ${el.tagName}.${el.className} overflow=${s.overflow}`);
          }
        }
      }
      if (header?.shadowRoot) {
        for (const el of header.shadowRoot.querySelectorAll('*')) {
          const s = getComputedStyle(el);
          if (s.overflow === 'hidden') {
            clippingElements.push(`header-shadow: ${el.tagName}.${el.className} overflow=${s.overflow}`);
          }
        }
      }

      // Check the dropdown's actual visual bounds using elementFromPoint
      const dropdownEl = document.querySelector('.user-dropdown');
      const signoutEl = document.querySelector('[data-testid="menu-signout"]');
      let signoutHitTestPasses = false;
      if (signoutEl) {
        const rect = signoutEl.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        signoutHitTestPasses = signoutEl.contains(hit) || hit === signoutEl;
      }

      return { clippingElements, signoutHitTestPasses };
    });

    // Log any shadow DOM clipping elements for debugging
    if (analysis.clippingElements.length > 0) {
      console.warn('Shadow DOM clipping elements found:', analysis.clippingElements);
    }

    // The Sign Out button must be clickable via hit testing (not occluded)
    expect(analysis.signoutHitTestPasses).toBe(true);
  });

  test('toggle: clicking trigger twice closes dropdown', async ({ authedPage: page }) => {
    const trigger = page.getByTestId('user-menu-trigger');
    await expect(trigger).toBeVisible({ timeout: 5_000 });

    // Open
    await trigger.click();
    const dropdown = page.locator('.user-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3_000 });

    // Close
    await trigger.click();
    await expect(dropdown).not.toBeVisible({ timeout: 3_000 });
  });
});
