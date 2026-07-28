/**
 * Full OAuth flow — simulates Google callback redirect with token in URL params.
 *
 * After Google consent, the worker redirects to:
 *   https://projectsites.dev/?token=...&email=...&auth_callback=google
 * The AppComponent reads these params, calls setSession(), and navigates to /admin.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('OAuth Callback — Token → Session → Admin', () => {
  test('visiting homepage with token param sets session and redirects to admin', async ({ page }) => {
    // Intercept navigation to verify redirect happens
    await page.goto(`${PROD_URL}/?token=test-session-token-123&email=brian@megabyte.space&auth_callback=google`);

    // Should redirect to /admin after processing token
    await page.waitForURL('**/admin**', { timeout: 10000 });

    // Verify the URL no longer contains token/email (cleaned up)
    const url = page.url();
    expect(url).not.toContain('token=');
    expect(url).not.toContain('email=');

    // Should be at the admin shell (or sign-in if token rejected)
    const currentUrl = page.url();
    expect(currentUrl).toContain('/admin');
  });

  test('sign-in page Google OAuth button produces correct redirect URL', async ({ page }) => {
    await page.goto(`${PROD_URL}/signin`);
    await page.waitForSelector('[data-testid="sign-in-page"]');

    const googleBtn = page.locator('[data-testid="sign-in-google"]');
    const href = await googleBtn.getAttribute('href');
    expect(href).toContain('/api/auth/google');
    expect(href).toContain('returnUrl=');
  });

  test('sign-up page Google OAuth button produces correct redirect URL', async ({ page }) => {
    await page.goto(`${PROD_URL}/auth/sign-up`);
    await page.waitForSelector('[data-testid="sign-up-page"]');

    const googleBtn = page.locator('[data-testid="sign-up-google"]');
    const href = await googleBtn.getAttribute('href');
    expect(href).toContain('/api/auth/google');
  });

  test('homepage without token params renders marketing surface', async ({ page }) => {
    await page.goto(PROD_URL);
    await expect(page.locator('app-root')).toBeVisible();
    // Should NOT redirect to admin
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).not.toContain('/admin');
  });
});
