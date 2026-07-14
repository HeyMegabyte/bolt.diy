/**
 * Real-Chrome sign-in test — uses the ?test=1 password seam to authenticate
 * as brian@megabyte.space with the E2E_TEST_PASSWORD secret, then verifies
 * the admin dashboard loads with zero console errors.
 *
 * This test drives a REAL Chrome browser (not headless Chromium) and
 * performs a genuine sign-in through the UI — no localStorage stubs,
 * no route interception. The server returns a real D1 session.
 *
 * Run:
 *   E2E_TEST_PASSWORD=$(get-secret E2E_TEST_PASSWORD) \
 *   npx playwright test --config=playwright.prod.config.ts \
 *     --project=chrome e2e/signin-chrome.e2e.ts
 */
import { test, expect } from '@playwright/test';

/** Filter benign console noise from third-party scripts. */
function isRealError(msg: string): boolean {
  const benign = [
    'favicon',
    'Third-party cookie',
    'cookie',
    'ga',
    'gtag',
    'googletagmanager',
    'google-analytics',
    'cdn-cgi',
    'cloudflareinsights',
    'content-security-policy',
  ];
  const lower = msg.toLowerCase();
  return !benign.some((p) => lower.includes(p));
}

test.describe('Real Chrome — test-login sign-in', () => {
  test('sign in with ?test=1 password seam, admin loads, zero console errors', async ({
    page,
  }) => {
    const password = process.env.E2E_TEST_PASSWORD;
    expect(password).toBeTruthy();

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    // ── Step 1: Navigate to sign-in with test mode enabled ──────────
    await page.goto('/signin?test=1');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // The test-login form should be visible: pre-filled email + password field
    await expect(page.locator('input[aria-label="Test password"]')).toBeVisible({
      timeout: 5000,
    });

    // ── Step 2: Fill the password and sign in ───────────────────────
    await page.fill('input[aria-label="Test password"]', password!);

    // Click the test sign-in button
    const signInBtn = page.locator('button', { hasText: /sign in/i }).last();
    await signInBtn.click();

    // ── Step 3: Wait for redirect to /admin ─────────────────────────
    await page.waitForURL('**/admin', { timeout: 15000 });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);

    // ── Step 4: Assert zero real console errors ─────────────────────
    const realErrors = errors.filter(isRealError);
    if (realErrors.length > 0) {
      console.error('ADMIN CONSOLE ERRORS:', JSON.stringify(realErrors, null, 2));
    }
    expect(realErrors).toHaveLength(0);
  });
});
