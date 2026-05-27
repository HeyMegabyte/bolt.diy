/**
 * super-admin-gating.spec.ts — TDD RED phase
 *
 * /dashboard/admin/* is visible only when user.email === SUPER_ADMIN_EMAIL.
 * Any other email gets a 404.  Tests both directions.
 */

import { test, expect } from '@playwright/test';
import { SUPER_ADMIN_EMAIL } from '../_fixtures/auth.js';

const ADMIN_ROUTES = [
  '/dashboard/admin',
  '/dashboard/admin/audit',
  '/dashboard/admin/users',
  '/dashboard/admin/sites',
] as const;

/* ------------------------------------------------------------------ */
/* Super-admin can access all admin routes                             */
/* ------------------------------------------------------------------ */

test.describe('super-admin access', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in as super-admin via the dev endpoint
    await page.goto('/');
    await page.route('**/api/dev/sign-in**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'super-admin-token',
          csrfToken: 'csrf-token',
          user: { email: SUPER_ADMIN_EMAIL, role: 'super_admin' },
        }),
      });
    });
    const resp = await page.request.post('/api/dev/sign-in', {
      data: { email: SUPER_ADMIN_EMAIL, password: 'test' },
    });
    const body = await resp.json() as { sessionToken: string; csrfToken: string };
    await page.context().addCookies([
      { name: 'session', value: body.sessionToken, domain: 'localhost', path: '/' },
    ]);
  });

  for (const route of ADMIN_ROUTES) {
    test(`super-admin can reach ${route}`, async ({ page }) => {
      await page.goto('/');
      const adminLink = page.getByRole('link', { name: /admin/i }).or(page.getByTestId('nav-admin'));
      if (await adminLink.isVisible()) await adminLink.click();

      await page.goto(route);
      // Must NOT be redirected to 404 or login
      await expect(page).not.toHaveURL(/\/404|\/not-found|\/login/, { timeout: 5_000 });
      // Page must render some content
      await expect(page.locator('main, [data-testid="admin-content"]')).toBeVisible({ timeout: 5_000 });
    });
  }
});

/* ------------------------------------------------------------------ */
/* Non-super-admin gets 404 on all admin routes                        */
/* ------------------------------------------------------------------ */

test.describe('non-super-admin gating', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in as a regular customer
    await page.goto('/');
    await page.route('**/api/dev/sign-in**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionToken: 'regular-user-token',
          csrfToken: 'csrf-token',
          user: { email: 'customer@example.com', role: 'customer' },
        }),
      });
    });
    const resp = await page.request.post('/api/dev/sign-in', {
      data: { email: 'customer@example.com', password: 'test' },
    });
    const body = await resp.json() as { sessionToken: string; csrfToken: string };
    await page.context().addCookies([
      { name: 'session', value: body.sessionToken, domain: 'localhost', path: '/' },
    ]);
  });

  for (const route of ADMIN_ROUTES) {
    test(`non-admin gets 404 on ${route}`, async ({ page }) => {
      await page.goto(route);
      // Must be on a 404 / not-found page OR redirected to dashboard
      const url = page.url();
      const is404 = /404|not-found/.test(url);
      const isRedirected = /dashboard(?!\/admin)/.test(url);
      expect(
        is404 || isRedirected,
        `Expected 404 or redirect away from admin, but URL is: ${url}`,
      ).toBe(true);
    });
  }

  test('admin link is not visible in nav for non-admin user', async ({ page }) => {
    await page.goto('/dashboard');
    const adminLink = page.getByTestId('nav-admin').or(page.getByRole('link', { name: /^admin$/i }));
    // Should not be present at all
    await expect(adminLink).not.toBeVisible({ timeout: 5_000 });
  });
});
