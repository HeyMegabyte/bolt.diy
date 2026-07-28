/**
 * F001 — Sign-in must render every auth method the backend supports.
 *
 * The backend Better Auth config (auth/better-auth.ts:140-148) conditionally
 * includes socialProviders { google, github } when GOOGLE_CLIENT_ID / GITHUB_CLIENT_ID
 * are set. The frontend MUST render buttons for every configured provider.
 *
 * Gap discovered 2026-07-27 via Browserbase visual scan — only email/password +
 * magic link were visible. Google + GitHub buttons were missing despite backend
 * configuration.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Sign-in — OAuth button visibility', () => {
  test('Google OAuth button is visible on /signin', async ({ page }) => {
    await page.goto(`${PROD_URL}/signin`);
    await page.waitForSelector('[data-testid="sign-in-page"]');

    const googleBtn = page.locator('[data-testid="sign-in-google"]');
    await expect(googleBtn).toBeVisible({ timeout: 5000 });
    await expect(googleBtn).toHaveText(/Google|google/i);
  });

  test('GitHub OAuth button is visible on /signin', async ({ page }) => {
    await page.goto(`${PROD_URL}/signin`);
    await page.waitForSelector('[data-testid="sign-in-page"]');

    const githubBtn = page.locator('[data-testid="sign-in-github"]');
    await expect(githubBtn).toBeVisible({ timeout: 5000 });
    await expect(githubBtn).toHaveText(/GitHub|github/i);
  });

  test('at least 2 OAuth methods are visible on /signin', async ({ page }) => {
    await page.goto(`${PROD_URL}/signin`);
    await page.waitForSelector('[data-testid="sign-in-page"]');

    const oauthButtons = page.locator('[data-testid="sign-in-google"], [data-testid="sign-in-github"]');
    const count = await oauthButtons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('OAuth buttons navigate to correct endpoints', async ({ page }) => {
    await page.goto(`${PROD_URL}/signin`);
    await page.waitForSelector('[data-testid="sign-in-page"]');

    const googleBtn = page.locator('[data-testid="sign-in-google"]');
    const href = await googleBtn.getAttribute('href');
    expect(href).toContain('/api/auth/google');
  });
});
