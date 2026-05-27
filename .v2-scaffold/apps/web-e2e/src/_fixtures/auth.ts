/**
 * Auth fixtures for the Phase-7 TDD suite.
 *
 * @remarks
 * `authedPage` — signs in as `brian@megabyte.space` (super-admin) via a
 * dev-only signed-token endpoint gated by `NODE_ENV !== 'production'`.
 *
 * `anonPage` — ensures a fully unauthenticated browser context (cleared
 * localStorage, sessionStorage, and cookies).
 *
 * Both fixtures start at the homepage `/` per the hermetic-spec contract.
 */

import { test as base, type Page } from '@playwright/test';

export const SUPER_ADMIN_EMAIL = 'brian@megabyte.space';
export const TEST_USER_PASSWORD = process.env['TEST_USER_PASSWORD'] ?? 'test-password-dev';

/** Shape returned by the dev-only sign-in endpoint */
interface DevSignInResponse {
  readonly sessionToken: string;
  readonly csrfToken: string;
}

/**
 * Injects a valid session cookie into `page` by posting to the dev-only
 * `/api/dev/sign-in` endpoint.  That endpoint must:
 *   - exist only when `NODE_ENV !== 'production'`
 *   - accept `{ email, password }` JSON
 *   - return `{ sessionToken, csrfToken }` and `Set-Cookie` headers
 *
 * @throws When the endpoint is unavailable (production guard active).
 */
async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto('/');

  const response = await page.request.post('/api/dev/sign-in', {
    data: { email: SUPER_ADMIN_EMAIL, password: TEST_USER_PASSWORD },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok()) {
    throw new Error(
      `Dev sign-in endpoint failed (status ${response.status()}). ` +
        'Ensure NODE_ENV !== "production" and the endpoint is registered.',
    );
  }

  const body = (await response.json()) as DevSignInResponse;

  // Propagate session cookie returned by Set-Cookie header from the API call
  // into the browser context so subsequent page navigations are authenticated.
  await page.context().addCookies([
    {
      name: 'session',
      value: body.sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  // Store CSRF token in localStorage for Angular interceptor pick-up.
  await page.evaluate((token: string) => {
    window.localStorage.setItem('csrf_token', token);
  }, body.csrfToken);
}

/** Extended fixture types */
interface AuthFixtures {
  /** A page already authenticated as super-admin brian@megabyte.space */
  authedPage: Page;
  /** A page with all storage and cookies cleared (anonymous context) */
  anonPage: Page;
}

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    await signInAsAdmin(page);
    await use(page);
  },

  anonPage: async ({ page }, use) => {
    await page.context().clearCookies();
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto('/');
    await use(page);
  },
});

export { expect } from '@playwright/test';
