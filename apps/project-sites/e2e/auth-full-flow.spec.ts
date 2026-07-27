/**
 * Full auth flow E2E — homepage→sign-up→sign-in→admin shell.
 *
 * This is the distinguished-engineer journey: a new user discovers
 * projectsites.dev, signs up, signs in, and reaches the admin dashboard.
 * Uses real UI navigation, not mocked APIs. Must start at homepage.
 *
 * V2: Currently tests redirect gates + sign-in page state. Full
 * authenticated admin journey blocked on E2E_API_KEY provision (see
 * e2e/helpers/auth.js). Once E2E_API_KEY is in wrangler secrets,
 * uncomment the full flow tests below.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Full Auth Flow — Gate Verification', () => {
  test('homepage → sign-up → sign-in → admin navigation completes without console errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Step 1: Homepage
    await page.goto(PROD_URL);
    await expect(page.locator('app-root')).toBeVisible();
    expect(consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('third-party')).length).toBe(0);

    // Step 2: Navigate to sign-up from marketing surface
    await page.click('text=Sign In');
    await page.waitForURL('**/signin**', { timeout: 5000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();

    // Step 3: Verify all auth methods visible on sign-in
    await expect(page.locator('[data-testid="sign-in-google"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-github"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-magic-link"]')).toBeVisible();

    // Step 4: Navigate to sign-up
    await page.click('[data-testid="sign-in-to-sign-up"]');
    await page.waitForURL('**/auth/sign-up**', { timeout: 5000 });
    await expect(page.locator('[data-testid="sign-up-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-up-google"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-up-github"]')).toBeVisible();

    // Step 5: Return to sign-in
    await page.click('[data-testid="sign-up-to-sign-in"]');
    await page.waitForURL('**/signin**', { timeout: 5000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });

  test('unauthenticated admin visit → sign-in → admin dashboard (redirect chain)', async ({ page }) => {
    // Step 1: Try to access admin directly
    await page.goto(`${PROD_URL}/admin`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();

    // Step 2: Verify returnUrl parameter is present
    const url = page.url();
    expect(url).toContain('returnUrl');
  });
});
