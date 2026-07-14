/**
 * Sign-in verification — zero console errors on homepage, /signin, and /admin.
 *
 * Stubs API endpoints so the admin shell renders without auth errors.
 *
 * Run:
 *   npx playwright test --config=playwright.prod.config.ts \
 *     e2e/signin-green.e2e.ts
 */
import { test, expect } from '@playwright/test';

const TEST_USER_RESPONSE = {
  data: {
    user_id: 'e2e-test-user',
    org_id: 'e2e-test-org',
    email: 'test@megabyte.space',
    display_name: 'E2E Test User',
    is_super_admin: 1,
  },
};

const EMPTY_LIST = { data: [] };
const EMPTY_PAGE = { data: [], total: 0 };

/** Filter benign console noise expected in headless browsers. */
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

/** Collect console + page errors during the callback. */
async function collectErrors(
  page: Parameters<Parameters<typeof test>[1]>[0]['page'],
  fn: () => Promise<void>,
): Promise<string[]> {
  const errors: string[] = [];
  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') errors.push(msg.text());
  };
  const onPageError = (err: Error) => errors.push(err.message);

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  await fn();

  // Remove listeners so they don't leak between tests
  page.off('console', onConsole);
  page.off('pageerror', onPageError);

  return errors.filter(isRealError);
}

test.describe('Sign-in — zero console errors', () => {
  test('homepage loads with no console errors', async ({ page }) => {
    const errors = await collectErrors(page, async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
    });

    if (errors.length > 0) {
      console.error('HOMEPAGE ERRORS:', JSON.stringify(errors, null, 2));
    }
    expect(errors).toHaveLength(0);
  });

  test('/signin page renders with no console errors', async ({ page }) => {
    const errors = await collectErrors(page, async () => {
      await page.goto('/signin');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);
    });

    if (errors.length > 0) {
      console.error('SIGNIN ERRORS:', JSON.stringify(errors, null, 2));
    }
    expect(errors).toHaveLength(0);
  });

  test('stub-auth → /admin loads with no console errors', async ({ page }) => {
    // Block the service worker so it doesn't interfere with route interception
    await page.route('**/ngsw-worker.js', (route) => route.abort());
    await page.route('**/ngsw.json', (route) => route.abort());
    await page.route('**/safety-worker.js', (route) => route.abort());

    // Intercept auth endpoint — must be registered BEFORE navigation
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TEST_USER_RESPONSE),
      }),
    );

    // Intercept admin dashboard API calls
    await page.route('**/api/sites', (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_LIST) });
      }
      return route.continue();
    });

    await page.route('**/api/inbox/tasks', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_LIST) }),
    );

    await page.route('**/api/audit/rows**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(EMPTY_PAGE) }),
    );

    await page.route('**/api/admin/domains/summary**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: {} }) }),
    );

    await page.route('**/api/billing/subscription**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { plan: 'pro', status: 'active' } }),
      }),
    );

    // Seed localStorage before SPA boots
    await page.addInitScript((user) => {
      localStorage.setItem('ps_session', JSON.stringify({ token: 'e2e-stub-token', email: user.data.email }));
      localStorage.setItem('ps_user', JSON.stringify(user.data));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    }, TEST_USER_RESPONSE);

    const errors = await collectErrors(page, async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      await page.goto('/admin');
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(5000);
    });

    if (errors.length > 0) {
      console.error('ADMIN ERRORS:', JSON.stringify(errors, null, 2));
    }
    expect(errors).toHaveLength(0);
  });
});
