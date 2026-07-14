/**
 * Sign-in verification — zero console errors on homepage, /signin, and /admin.
 *
 * Stubs /api/auth/me + admin dashboard API calls so the admin shell renders
 * without auth errors. This is the same pattern the existing fixture-based
 * suite uses: intercept the session endpoint, return a valid user.
 *
 * Run:
 *   npx playwright test --config=playwright.prod.config.ts \
 *     e2e/signin-final.e2e.ts
 */
import { test, expect } from '@playwright/test';

const TEST_USER = {
  data: {
    user_id: 'e2e-test-user',
    org_id: 'e2e-test-org',
    email: 'test@megabyte.space',
    display_name: 'E2E Test User',
    is_super_admin: 1,
  },
};

/** Seed localStorage + intercept /api/auth/me, so the SPA sees an authed user. */
async function setupStubAuth(page: Parameters<Parameters<typeof test>[1]>[0]['page']) {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(TEST_USER),
    });
  });

  // Silently succeed admin dashboard API calls so the admin shell loads
  // without 401 errors in the console. Each endpoint is stubbed individually
  // rather than blanket-matching, so we catch new endpoints that appear.
  const stubEmpty = (pattern: string | RegExp, body?: Record<string, unknown>) =>
    page.route(pattern, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body ?? { data: [] }),
      });
    });

  // Exact paths — the admin dashboard calls these on load
  await stubEmpty(/\/api\/sites(\?.*)?$/);
  await stubEmpty(/\/api\/inbox\/tasks(\?.*)?$/);
  await stubEmpty('**/api/audit/rows**', { data: [], total: 0 });
  await stubEmpty(/\/api\/admin\/domains\/summary(\?.*)?$/);

  await page.addInitScript((user: typeof TEST_USER) => {
    localStorage.setItem(
      'ps_session',
      JSON.stringify({ token: 'e2e-stub-token', email: user.data.email }),
    );
    localStorage.setItem('ps_user', JSON.stringify(user.data));
    localStorage.setItem('ps_feedback_dismissed', 'true');
  }, TEST_USER);
}

/** Filter benign console noise that's expected in a headless browser. */
function isRealError(msg: string): boolean {
  const benign = [
    'favicon',
    'Third-party cookie',
    'GA',
    'gtag',
    'googletagmanager',
    'google-analytics',
    'cdn-cgi',
    'cloudflareinsights',
    // CSP violations from third-party scripts (GA/GTM/CF) — not our code
    'content-security-policy',
    // Firefox-isms
    'moz',
  ];
  const lower = msg.toLowerCase();
  return !benign.some((p) => lower.includes(p.toLowerCase()));
}

test.describe('Sign-in — zero console errors', () => {
  test('homepage loads with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const realErrors = errors.filter(isRealError);
    if (realErrors.length > 0) {
      console.error('HOMEPAGE ERRORS:', JSON.stringify(realErrors, null, 2));
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
    await page.waitForTimeout(3000);

    const realErrors = errors.filter(isRealError);
    if (realErrors.length > 0) {
      console.error('SIGNIN ERRORS:', JSON.stringify(realErrors, null, 2));
    }
    expect(realErrors).toHaveLength(0);
  });

  test('stub-auth → /admin loads with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await setupStubAuth(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // Navigate to admin dashboard
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(5000);

    const realErrors = errors.filter(isRealError);
    if (realErrors.length > 0) {
      console.error('ADMIN ERRORS:', JSON.stringify(realErrors, null, 2));
    }
    expect(realErrors).toHaveLength(0);
  });
});
