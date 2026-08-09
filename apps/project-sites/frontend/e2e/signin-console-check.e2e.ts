/**
 * Focused smoke test: sign in with E2E_API_KEY, verify zero console errors.
 *
 * Run:
 *   E2E_API_KEY=$(get-secret E2E_API_KEY) \
 *   npx playwright test --config=playwright.prod.config.ts \
 *     e2e/signin-console-check.e2e.ts
 */
import { test, expect } from '@playwright/test';

test.describe('Sign-in — zero console errors', () => {
  test('homepage loads with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Let the page settle — some late-load scripts may fire
    await page.waitForTimeout(2000);

    expect(errors.filter((e) => !e.includes('favicon'))).toHaveLength(0);
  });

  test('sign in with E2E_API_KEY, admin loads, zero console errors', async ({
    page,
  }) => {
    // Needs the real API key seeded as a session — skip cleanly (don't hard-fail)
    // when E2E_API_KEY isn't in the env. The other two tests here need no secret.
    test.skip(!process.env.E2E_API_KEY, 'Requires E2E_API_KEY');
    const apiKey = process.env.E2E_API_KEY;

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    // Seed the real E2E API key as ps_session before the SPA boots
    await page.addInitScript(
      ({ key }: { key: string }) => {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token: key, email: 'test@megabyte.space' }),
        );
      },
      { key: apiKey! },
    );

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // After seeding, the SPA should show admin-accessible UI
    // Navigate to /admin via clicking or direct nav
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Filter out expected non-blocking noise
    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Third-party cookie') &&
        !e.includes('cookie'),
    );

    if (realErrors.length > 0) {
      console.error('CONSOLE ERRORS:', JSON.stringify(realErrors, null, 2));
    }

    expect(realErrors).toHaveLength(0);
  });

  test('/signin page renders with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/signin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const realErrors = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('Third-party cookie') &&
        !e.includes('cookie'),
    );

    if (realErrors.length > 0) {
      console.error('SIGNIN CONSOLE ERRORS:', JSON.stringify(realErrors, null, 2));
    }

    expect(realErrors).toHaveLength(0);
  });
});
