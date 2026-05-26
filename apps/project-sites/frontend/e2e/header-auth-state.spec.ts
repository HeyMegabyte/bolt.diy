import { test, expect, STUB_USER } from './fixtures';

/**
 * Auth-aware header — the marketing surface MUST know if you're signed in.
 *
 * Anonymous: header shows a "Sign In" CTA, no user menu, no notification bell.
 * Signed in (brian@megabyte.space, admin): header swaps the CTA for the user
 * menu with the user's avatar initial, plus the notification bell. Clicking
 * the avatar opens a dropdown with Dashboard / New Site / Billing / Sign Out
 * actions.
 *
 * Coverage is identical on every marketing route — we spot-check `/`, `/press`,
 * `/pricing`, `/integrations` to make sure the header behaves consistently.
 */

// `/` is intentionally headerless — the cinematic landing has its own nav.
// Auth state on the homepage is covered separately in `cinematic-auth.spec.ts`.
const PUBLIC_ROUTES = ['/press', '/integrations', '/contact', '/roadmap', '/changelog'];

test.describe('Header — anonymous state', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`shows Sign In CTA on ${route}`, async ({ anonPage: page }) => {
      await page.goto(route);
      const cta = page.locator('.header-signin-btn');
      await expect(cta).toBeVisible();
      await expect(cta).toContainText(/Sign In/i);
      // User menu must NOT render
      await expect(page.locator('.user-menu')).toHaveCount(0);
      await expect(page.locator('app-notification-bell')).toHaveCount(0);
    });
  }

  test('clicking Sign In routes to /signin', async ({ anonPage: page }) => {
    await page.goto('/press');
    await Promise.all([
      page.waitForURL('**/signin'),
      page.locator('.header-signin-btn').click(),
    ]);
    expect(page.url()).toContain('/signin');
  });
});

test.describe('Header — signed in as brian@megabyte.space (admin)', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`shows user avatar + bell on ${route}`, async ({ authedPage: page }) => {
      await page.goto(route);
      // Sign-in CTA must NOT be present
      await expect(page.locator('.header-signin-btn')).toHaveCount(0);
      // User menu visible
      await expect(page.locator('.user-menu')).toBeVisible();
      // Avatar initial = first letter of name/email
      const avatar = page.locator('.user-menu .user-avatar').first();
      await expect(avatar).toContainText(STUB_USER.email.charAt(0).toUpperCase());
      // Notification bell rendered
      await expect(page.locator('app-notification-bell')).toBeVisible();
    });
  }

  test('user menu dropdown opens, shows admin actions, closes on Esc', async ({ authedPage: page }) => {
    await page.goto('/press');
    await page.locator('.user-menu').click();
    const dropdown = page.locator('.user-menu .dropdown');
    await expect(dropdown).toBeVisible();
    // Email matches the stubbed user
    await expect(dropdown.locator('.dropdown-email')).toHaveText(STUB_USER.email);
    // Admin actions: Dashboard, New Site, Billing, Sign Out
    await expect(dropdown.locator('.dropdown-item', { hasText: 'Dashboard' })).toBeVisible();
    await expect(dropdown.locator('.dropdown-item', { hasText: 'New Site' })).toBeVisible();
    await expect(dropdown.locator('.dropdown-item', { hasText: 'Billing' })).toBeVisible();
    await expect(dropdown.locator('.dropdown-item.logout', { hasText: 'Sign Out' })).toBeVisible();
  });

  test('Dashboard menu item routes to /admin', async ({ authedPage: page }) => {
    await page.goto('/press');
    await page.locator('.user-menu').click();
    await Promise.all([
      page.waitForURL('**/admin', { timeout: 6000 }),
      page.locator('.dropdown-item', { hasText: 'Dashboard' }).click(),
    ]);
    expect(page.url()).toContain('/admin');
  });

  test('Sign Out clears session + reveals Sign In CTA again', async ({ authedPage: page }) => {
    await page.goto('/press');
    await page.locator('.user-menu').click();
    await page.locator('.dropdown-item.logout', { hasText: 'Sign Out' }).click();
    // Wait for the Sign-In CTA to appear (Angular re-renders the header
    // after AuthService clears the session). Polling here is what makes the
    // assertion robust to the post-click click-handler tick.
    await expect(page.locator('.header-signin-btn')).toBeVisible({ timeout: 8000 });
    // Session cleared in localStorage
    const session = await page.evaluate(() => localStorage.getItem('ps_session'));
    expect(session).toBeNull();
  });
});
