/**
 * Appsmith login page smoke test.
 *
 * Verifies `https://appsmith.projectsites.dev` renders the Appsmith
 * sign-in page with HTTP 200.
 *
 * Run: npx playwright test apps/project-sites/infra/appsmith/appsmith.smoke.spec.ts
 */

import { test, expect } from '@playwright/test';

const APPSMITH_URL = process.env.APPSMITH_URL ?? 'https://appsmith.projectsites.dev';

test.describe('Appsmith login page', () => {
  test('renders sign-in page with HTTP 200', async ({ page }) => {
    // Appsmith first boot can take 3-5 minutes. Wait generously.
    test.setTimeout(600_000);

    const response = await page.goto(APPSMITH_URL, {
      waitUntil: 'networkidle',
      timeout: 300_000,
    });

    expect(response?.status()).toBe(200);

    // Appsmith shows an interstitial "Appsmith is starting" page during
    // first boot. Wait for the actual login/sign-in UI.
    await page.waitForFunction(
      () => {
        const body = document.body.innerText;
        return (
          /sign in|login|sign up|create account|email|password/i.test(body) &&
          !/Appsmith is starting/i.test(body)
        );
      },
      { timeout: 480_000 },
    );

    // Assert login form elements are present
    const hasLoginForm = await page.getByRole('textbox').count();
    expect(hasLoginForm).toBeGreaterThan(0);

    // Take screenshot for visual verification
    await page.screenshot({
      path: 'e2e/screenshots/appsmith-login.png',
      fullPage: true,
    });
  });
});
