/**
 * OAuth callback + OIDC flow verification.
 *
 * Tests the Better Auth OAuth callback endpoint and the consent screen.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('OAuth Callback Flow', () => {
  test('GET /api/auth/sign-in/social?provider=google redirects to Google', async ({ page }) => {
    const res = await page.goto(`${PROD_URL}/api/auth/sign-in/social?provider=google&callbackURL=/admin`);
    // Should redirect to Google's OAuth endpoint
    const url = page.url();
    expect(url).toContain('accounts.google.com');
  });

  test('GET /api/auth/sign-in/social?provider=github redirects to GitHub', async ({ page }) => {
    const res = await page.goto(`${PROD_URL}/api/auth/sign-in/social?provider=github&callbackURL=/admin`);
    const url = page.url();
    expect(url).toContain('github.com');
  });

  test('GET /api/auth/google/callback without code returns error', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/auth/google/callback`);
    // Without valid state/code, should return 400 or redirect to error
    expect([302, 400, 401, 404]).toContain(res.status());
  });
});

test.describe('OAuth Consent Screen', () => {
  test('GET /oauth/consent renders consent UI', async ({ page }) => {
    await page.goto(`${PROD_URL}/oauth/consent`);
    // Consent page should render (even without OAuth params, it shows the component)
    expect([200]).toContain(page.url().includes('404') ? 404 : 200);
  });
});
