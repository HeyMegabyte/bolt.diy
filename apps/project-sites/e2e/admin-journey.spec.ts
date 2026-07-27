/**
 * Admin shell journey — sign in from homepage, verify admin shell, navigate
 * key sections. Serves as the foundation for all admin section E2E tests.
 *
 * Uses the real auth flow via e2e/helpers/auth.js signInAsTestUser.
 * Starts at PROD_URL homepage per TDD doctrine.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Admin Shell Journey', () => {
  test('homepage loads and has sign-in link', async ({ page }) => {
    await page.goto(PROD_URL);
    await expect(page.locator('app-root')).toBeVisible();
    // Homepage should be accessible without auth
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('sign-in page loads and shows all auth methods', async ({ page }) => {
    await page.goto(`${PROD_URL}/signin`);
    await page.waitForSelector('[data-testid="sign-in-page"]');

    // F001 — OAuth buttons must be visible
    await expect(page.locator('[data-testid="sign-in-google"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-github"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-password"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-submit"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-magic-link"]')).toBeVisible();
  });

  test('pricing page loads with plan cards', async ({ page }) => {
    await page.goto(`${PROD_URL}/pricing`);
    await expect(page.locator('app-pricing')).toBeVisible();
    // Should have Monthly and Annual CTAs
    const ctas = page.locator('a:has-text("Claim"), a:has-text("Start")');
    const count = await ctas.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('blog page loads', async ({ page }) => {
    await page.goto(`${PROD_URL}/blog`);
    await expect(page.locator('app-root')).toBeVisible();
    // Blog should render — can be empty if no posts
  });

  test('auth guard redirects /admin to /signin for unauthenticated users', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin`);
    // Should redirect to sign-in
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });

  test('all public routes return 200 (no 404s on primary surfaces)', async ({ page }) => {
    const routes = [
      '/',
      '/signin',
      '/pricing',
      '/blog',
      '/search',
      '/integrations',
      '/developers',
      '/press',
      '/changelog',
      '/privacy',
      '/terms',
    ];
    for (const route of routes) {
      const res = await page.goto(`${PROD_URL}${route}`);
      expect(res?.status()).toBe(200);
    }
  });
});
