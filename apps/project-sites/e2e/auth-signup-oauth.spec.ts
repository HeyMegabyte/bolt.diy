/**
 * Sign-up OAuth button visibility — verifies Pass 8 fix.
 *
 * The sign-up page must render Google + GitHub OAuth buttons alongside
 * the email/password registration form, mirroring the sign-in page.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Sign-up — OAuth button visibility', () => {
  test('sign-up page loads with Google OAuth button', async ({ page }) => {
    await page.goto(`${PROD_URL}/auth/sign-up`);
    await page.waitForSelector('[data-testid="sign-up-page"]');
    await expect(page.locator('[data-testid="sign-up-google"]')).toBeVisible();
  });

  test('sign-up page loads with GitHub OAuth button', async ({ page }) => {
    await page.goto(`${PROD_URL}/auth/sign-up`);
    await page.waitForSelector('[data-testid="sign-up-page"]');
    await expect(page.locator('[data-testid="sign-up-github"]')).toBeVisible();
  });

  test('sign-up form elements are all present', async ({ page }) => {
    await page.goto(`${PROD_URL}/auth/sign-up`);
    await page.waitForSelector('[data-testid="sign-up-page"]');
    await expect(page.locator('[data-testid="sign-up-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-up-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-up-password"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-up-submit"]')).toBeVisible();
  });

  test('sign-up page links to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/auth/sign-up`);
    await page.waitForSelector('[data-testid="sign-up-page"]');
    await expect(page.locator('[data-testid="sign-up-to-sign-in"]')).toBeVisible();
  });
});
