/**
 * Shared Playwright fixtures for E2E tests.
 *
 * Provides two page fixtures:
 * - `page` — standard page with external CDN requests blocked so
 *   `page.goto()` doesn't hang waiting for unreachable resources in CI.
 * - `authedPage` — same CDN blocking plus a pre-authenticated session via
 *   {@link signInAsTestUser}. Ready to interact with any authenticated surface
 *   immediately after the fixture is granted to the test.
 *
 * @example Using the authed fixture:
 * ```ts
 * import { test, expect } from './fixtures.js';
 *
 * test('admin panel loads', async ({ authedPage: page }) => {
 *   await expect(page.locator('[data-testid="admin-shell"]')).toBeVisible();
 * });
 * ```
 */
import { test as base } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';

// ---------------------------------------------------------------------------
// CDN blocklist
// ---------------------------------------------------------------------------

/**
 * Returns `true` for hostnames that should be blocked in E2E tests.
 * Blocking these prevents slow/failed page loads caused by unreachable CDNs
 * in CI environments while still allowing requests to the app under test.
 */
function _isCdnHost(url: URL): boolean {
  const { hostname } = url;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return false;

  // Allow requests to the configured PROD_URL host so smoke tests can hit prod
  const prodUrl = process.env.PROD_URL;
  if (prodUrl) {
    try {
      const prodHost = new URL(prodUrl).hostname;
      if (hostname === prodHost || hostname.endsWith(`.${prodHost}`)) {
        return false;
      }
    } catch {
      // malformed PROD_URL — fall through to default block
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

interface ProjectSitesFixtures {
  /**
   * A Playwright `Page` that has been pre-authenticated as the E2E test user
   * (`test@megabyte.space` or `E2E_USER_EMAIL`).
   *
   * External CDN requests are blocked (same as `page`).
   * Sign-in is performed via {@link signInAsTestUser} before the page is
   * yielded to the test body.
   *
   * Use `authedPage` anywhere you would previously have called
   * `signInAsTestUser(page)` at the start of a test.
   */
  authedPage: import('@playwright/test').Page;
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

export const test = base.extend<ProjectSitesFixtures>({
  // Override the built-in `page` fixture to block external CDN requests.
  page: async ({ page }, use) => {
    // Block all requests to external domains so the page load event fires quickly.
    // The HTML loads resources from CDNs that may be unreachable in CI/sandbox.
    await page.route(_isCdnHost, (route) => route.abort());
    await use(page);
  },

  // New `authedPage` fixture: CDN-blocked + pre-authenticated.
  authedPage: async ({ browser }, use) => {
    // Create a fresh browser context so the auth stub doesn't bleed into
    // other tests running in parallel.
    const context = await browser.newContext();
    const page = await context.newPage();

    // Block external CDN requests (same policy as the `page` fixture above).
    await page.route(_isCdnHost, (route) => route.abort());

    // Navigate to the app root first so addInitScript + route mocks take effect
    // before any app scripts run.
    const baseUrl =
      process.env.PROD_URL ??
      process.env.BASE_URL ??
      'http://localhost:8787';
    await page.goto(baseUrl);

    // Sign in as the test user (seeds localStorage + stubs /api/auth/me).
    await signInAsTestUser(page);

    // Yield the authenticated page to the test body.
    await use(page);

    // Cleanup: close the isolated context after the test finishes.
    await context.close();
  },
});

export { expect } from '@playwright/test';
