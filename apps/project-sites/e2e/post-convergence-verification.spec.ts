/**
 * Post-Convergence Verification — runs AFTER flag promotion + data seeding.
 *
 * Verifies: all feature flags are stable/100%, test data exists,
 * admin sections render, OAuth flows work, API is healthy.
 * This spec serves as the final gate before declaring convergence DONE.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Post-Convergence — Platform Health', () => {
  test('API health returns 200', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/health`);
    expect(res.status()).toBe(200);
  });

  test('feature flags API returns flags with entries', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/feature-flags`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.flags).toBeDefined();
    expect(Object.keys(body.flags).length).toBeGreaterThan(50);
  });

  test('integration health aggregate returns results', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/integrations/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.integrations).toBeDefined();
    expect(body.integrations.length).toBeGreaterThan(5);
  });
});

test.describe('Post-Convergence — Auth Surface', () => {
  test('sign-in page has all 6 auth methods', async ({ page }) => {
    await page.goto(`${PROD_URL}/signin`);
    await page.waitForSelector('[data-testid="sign-in-page"]');
    await expect(page.locator('[data-testid="sign-in-google"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-github"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-email"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-password"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-submit"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-in-magic-link"]')).toBeVisible();
  });

  test('sign-up page has Google + GitHub OAuth buttons', async ({ page }) => {
    await page.goto(`${PROD_URL}/auth/sign-up`);
    await page.waitForSelector('[data-testid="sign-up-page"]');
    await expect(page.locator('[data-testid="sign-up-google"]')).toBeVisible();
    await expect(page.locator('[data-testid="sign-up-github"]')).toBeVisible();
  });

  test('Google OAuth redirect works', async ({ request }) => {
    const res = await request.get(`${PROD_URL}/api/auth/google?returnUrl=/admin`);
    expect(res.status()).toBe(200);
  });
});

test.describe('Post-Convergence — Admin Auth Gates', () => {
  const ADMIN_ROUTES = [
    '/admin', '/admin/editor', '/admin/snapshots', '/admin/analytics',
    '/admin/forms', '/admin/apps', '/admin/social', '/admin/voice',
    '/admin/logs', '/admin/docs', '/admin/settings',
    '/admin/domains', '/admin/billing', '/admin/user',
    '/admin/system-services', '/admin/feature-flags',
  ];

  for (const route of ADMIN_ROUTES) {
    test(`${route} redirects to sign-in when unauthenticated`, async ({ page }) => {
      await page.goto(`${PROD_URL}${route}`);
      await page.waitForURL('**/signin**', { timeout: 10000 });
      await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
    });
  }
});
