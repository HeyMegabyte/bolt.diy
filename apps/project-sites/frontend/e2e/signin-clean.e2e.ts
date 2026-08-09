/**
 * Clean sign-in verification: stub-auth approach, zero console errors.
 *
 * Uses Pathway A from helpers/auth.ts — intercepts /api/auth/me and seeds
 * ps_session in localStorage. This is the most reliable approach for E2E
 * testing since it doesn't depend on D1 state or API key validity.
 *
 * Run:
 *   npx playwright test --config=playwright.prod.config.ts \
 *     e2e/signin-clean.e2e.ts
 */
import { test, expect } from '@playwright/test';

const TEST_USER = {
  user_id: 'e2e-test-user',
  email: 'test@megabyte.space',
  name: 'E2E Test User',
  plan: 'pro',
};

test.describe('Clean sign-in — zero console errors', () => {
  test('homepage loads with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Skip known benign noise
    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Third-party cookie') &&
        !e.includes('GA') &&
        !e.includes('gtag'),
    );

    if (realErrors.length > 0) {
      console.error('HOMEPAGE CONSOLE ERRORS:', JSON.stringify(realErrors, null, 2));
    }
    expect(realErrors).toHaveLength(0);
  });

  test('sign-in via stub, admin panel loads, zero console errors', async ({
    page,
  }) => {
    // A fake token 401s on the admin shell's REAL /api GETs (→ "Failed to load
    // resource: 401" console errors + a bounce to /signin). Seed the real E2E_API_KEY
    // so those calls succeed (200) — a genuinely signed-in, console-clean /admin.
    // Skip when the key isn't exported (conditional-ci-gates: fail-open).
    test.skip(!process.env.E2E_API_KEY, 'requires E2E_API_KEY for a valid /admin session');
    const KEY = process.env.E2E_API_KEY as string;
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    // Intercept /api/auth/me — return a valid user so the SPA sees
    // an authenticated session immediately.
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: TEST_USER }),
      });
    });

    // Seed ps_session with the REAL key before the SPA boots.
    await page.addInitScript(
      ({ user, key }: { user: typeof TEST_USER; key: string }) => {
        localStorage.setItem('ps_session', JSON.stringify({ token: key, email: user.email }));
        localStorage.setItem('ps_user', JSON.stringify(user));
      },
      { user: TEST_USER, key: KEY },
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Navigate to admin — use the nav link or direct URL
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(4000);

    // Filter benign noise
    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Third-party cookie') &&
        !e.includes('GA') &&
        !e.includes('gtag') &&
        !e.includes('googletagmanager') &&
        !e.includes('google-analytics') &&
        !e.includes('cdn-cgi'),
    );

    if (realErrors.length > 0) {
      console.error('ADMIN CONSOLE ERRORS:', JSON.stringify(realErrors, null, 2));
    }
    expect(realErrors).toHaveLength(0);
  });

  test('/signin page renders cleanly with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/signin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Third-party cookie') &&
        !e.includes('GA') &&
        !e.includes('gtag') &&
        !e.includes('googletagmanager') &&
        !e.includes('google-analytics') &&
        !e.includes('cdn-cgi'),
    );

    if (realErrors.length > 0) {
      console.error('SIGNIN CONSOLE ERRORS:', JSON.stringify(realErrors, null, 2));
    }
    expect(realErrors).toHaveLength(0);
  });
});
