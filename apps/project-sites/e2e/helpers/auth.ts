/**
 * @module e2e/helpers/auth
 * @description Real-user auth helpers for E2E tests against projectsites.dev.
 *
 * Two authentication pathways are supported:
 *
 * **Pathway A — stub (current default)**
 * Seeds `ps_session` into localStorage and stubs `/api/auth/me` so the
 * frontend sees a signed-in user without hitting a real email inbox.
 * Used when `PROD_URL === 'https://projectsites.dev'` OR when the worker
 * has not yet shipped the test-peek endpoint.
 *
 * **Pathway B — real magic-link round-trip (future)**
 * Requires the worker to expose `GET /api/auth/magic-link/peek?email=...`
 * (a test-only endpoint that returns the most-recent raw token for an email
 * address — guarded by `env.E2E_PEEK_SECRET` so it never leaks in prod).
 * Switch `STUB_AUTH=0` once the endpoint ships.
 *
 * @example
 * ```ts
 * import { signInAsTestUser, gotoAdmin } from './helpers/auth.js';
 *
 * test('admin renders', async ({ page }) => {
 *   await page.goto(process.env.PROD_URL!);
 *   await signInAsTestUser(page);
 *   await gotoAdmin(page);
 * });
 * ```
 */

import { type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TEST_EMAIL =
  process.env.E2E_USER_EMAIL ?? 'test@megabyte.space';

const DEFAULT_TEST_PASSWORD = process.env.TEST_USER_PASSWORD ?? 'test-stub';

/**
 * Fake session token used by Pathway A (stub).
 * The stubbed `/api/auth/me` handler will echo this back as the session.
 */
const STUB_TOKEN = 'e2e-stub-session-token';

/**
 * Fake user object returned by the stubbed `/api/auth/me` endpoint.
 * Must satisfy the shape the frontend reads after sign-in.
 */
const STUB_USER = {
  user_id: 'e2e-test-user-id',
  email: DEFAULT_TEST_EMAIL,
  name: 'E2E Test User',
  plan: 'pro',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Seeds the `ps_session` localStorage entry and intercepts `/api/auth/me`
 * so the SPA treats the browser as signed in without a real token exchange.
 *
 * **Switch to Pathway B** once `GET /api/auth/magic-link/peek` is deployed
 * on the worker. Remove this function and implement the real round-trip in
 * `signInAsTestUser` instead.
 *
 * @param page - Playwright Page instance.
 * @param email - Email address to embed in the stub session.
 * @internal
 */
async function _stubSignIn(page: Page, email: string): Promise<void> {
  // Intercept /api/auth/me before navigation so the SPA picks up the session
  // on its first boot-time call.
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...STUB_USER, email }),
    });
  });

  // Inject the session token into localStorage before page scripts run.
  await page.addInitScript(
    ({ token, sessionEmail }: { token: string; sessionEmail: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token, email: sessionEmail }),
      );
    },
    { token: STUB_TOKEN, sessionEmail: email },
  );
}

/**
 * Performs a real magic-link round-trip using the worker's test-peek endpoint.
 *
 * Prerequisites (all must be true to use Pathway B):
 * - `STUB_AUTH` env var is `'0'`
 * - Worker has deployed `GET /api/auth/magic-link/peek?email=...&secret=...`
 * - `E2E_PEEK_SECRET` env var matches the worker's `env.E2E_PEEK_SECRET`
 *
 * Flow:
 * 1. Navigate to `/signin`
 * 2. Fill email, click "Send magic link"
 * 3. Poll `GET /api/auth/magic-link/peek?email=...` until a token appears
 * 4. Navigate to `/?token=...&email=...` (the magic-link callback URL)
 * 5. Wait for the SPA to store the session
 *
 * @param page - Playwright Page instance.
 * @param prodUrl - Production base URL (e.g. `https://projectsites.dev`).
 * @param email - Test email address.
 * @internal
 *
 * @remarks
 * **TODO**: Wire this pathway once the worker ships the peek endpoint.
 * Remove the `_stubSignIn` fallback in `signInAsTestUser` when Pathway B
 * is stable across all E2E environments.
 */
async function _realMagicLinkSignIn(
  page: Page,
  prodUrl: string,
  email: string,
): Promise<void> {
  const peekSecret = process.env.E2E_PEEK_SECRET ?? '';

  // Step 1: navigate to signin and fill in the email
  await page.goto(`${prodUrl}/`);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const nav = w.navigateTo as (s: string) => void;
    if (typeof nav === 'function') nav('signin');
  });

  // Show the email panel
  await page.locator('[onclick*="showSigninPanel(\'email\')"]').click();
  await page.locator('#email-input').fill(email);
  const sendBtn = page.locator('[onclick*="sendMagicLink"]').first();
  await sendBtn.click();

  // Step 2: poll the peek endpoint (max 30 s)
  const peekUrl = `${prodUrl}/api/auth/magic-link/peek?email=${encodeURIComponent(email)}&secret=${encodeURIComponent(peekSecret)}`;
  let token: string | null = null;
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const res = await page.request.get(peekUrl);
    if (res.ok()) {
      const json = (await res.json()) as { token?: string };
      if (json.token) {
        token = json.token;
        break;
      }
    }
    // Brief pause before retry — no setTimeout, use Playwright's built-in wait
    await page.waitForTimeout(1_000);
  }

  if (!token) {
    throw new Error(
      `[auth.ts] Timed out waiting for magic-link token via peek endpoint for ${email}. ` +
        'Ensure /api/auth/magic-link/peek is deployed and E2E_PEEK_SECRET is set.',
    );
  }

  // Step 3: complete the callback
  await page.goto(`${prodUrl}/?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`);
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('ps_session');
    return raw !== null;
  }, { timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Signs in as the E2E test user.
 *
 * Automatically selects the right pathway:
 * - **Pathway A (stub)**: default; used when `STUB_AUTH` is not `'0'`.
 * - **Pathway B (real)**: used when `STUB_AUTH=0` AND the worker's peek
 *   endpoint is live. Performs a full magic-link round-trip.
 *
 * After this call the browser's `localStorage.ps_session` is populated
 * and `/api/auth/me` will return the test user.
 *
 * @param page - Playwright Page instance.
 * @param opts - Optional overrides.
 * @param opts.email - Override the test email (default: `E2E_USER_EMAIL` env
 *   or `test@megabyte.space`).
 *
 * @example
 * ```ts
 * test('admin loads', async ({ page }) => {
 *   await page.goto(process.env.PROD_URL!);
 *   await signInAsTestUser(page);
 *   await expect(page.locator('[data-testid="admin-shell"]')).toBeVisible();
 * });
 * ```
 */
export async function signInAsTestUser(
  page: Page,
  opts?: { email?: string },
): Promise<void> {
  const email = opts?.email ?? DEFAULT_TEST_EMAIL;
  const prodUrl = process.env.PROD_URL ?? 'https://projectsites.dev';
  const useRealAuth = process.env.STUB_AUTH === '0';

  // Pathway C — REAL API-key auth (preferred when available).
  // `E2E_API_KEY` is a `psk_test_…` org-scoped key (test org `e2e-test-org`,
  // user `e2e-test-user`) the worker authenticates via the `api_keys` table.
  // Seeding it into `ps_session` gives the SPA a genuine session: `/api/auth/me`
  // returns the real test user and every data API responds with real (test-org)
  // data — no stubbing. This is what lets the journey browse live features.
  // Revoke by setting `revoked_at` on the `e2e-test-key` row in prod D1.
  const apiKey = process.env.E2E_API_KEY;
  if (apiKey) {
    await page.addInitScript(
      ({ token, sessionEmail }: { token: string; sessionEmail: string }) => {
        localStorage.setItem(
          'ps_session',
          JSON.stringify({ token, email: sessionEmail }),
        );
      },
      { token: apiKey, sessionEmail: email },
    );
    return;
  }

  if (useRealAuth) {
    // Pathway B — requires worker to have shipped /api/auth/magic-link/peek
    // TODO: remove the comment below once the endpoint is confirmed deployed.
    // Required follow-up: add GET /api/auth/magic-link/peek?email&secret to
    // apps/project-sites/src/routes/api.ts, guarded by env.E2E_PEEK_SECRET,
    // returning { token: string } for the most-recent unexpired magic_links row.
    await _realMagicLinkSignIn(page, prodUrl, email);
  } else {
    // Pathway A — stub (safe in all environments including production E2E)
    await _stubSignIn(page, email);
  }
}

/**
 * Signs out the currently authenticated user by clicking the avatar menu
 * and selecting "Sign out".
 *
 * Waits for the search screen to reappear, confirming the SPA navigated
 * back to the unauthenticated state.
 *
 * @param page - Playwright Page instance.
 *
 * @example
 * ```ts
 * await signInAsTestUser(page);
 * // ... do things ...
 * await signOut(page);
 * await expect(page.locator('[data-testid="search-screen"]')).toBeVisible();
 * ```
 */
export async function signOut(page: Page): Promise<void> {
  // Open the user avatar / account menu
  const avatarTrigger = page.locator(
    '[data-testid="user-avatar"], [data-testid="account-menu-trigger"]',
  );
  await avatarTrigger.first().click();

  // Click the sign-out action
  const signOutBtn = page.locator(
    '[data-testid="sign-out-btn"], [onclick*="logout"], text="Sign out"',
  );
  await signOutBtn.first().click();

  // Confirm the SPA is back at the unauthenticated search screen
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('ps_session');
    return raw === null;
  }, { timeout: 10_000 });
}

/**
 * Navigates to the admin panel (or a sub-route within it) via real UI clicks,
 * signing in first if the user is not already authenticated.
 *
 * Never calls `page.goto('/admin/...')` after the initial load — all navigation
 * is performed through the sidebar UI to emulate a real user.
 *
 * @param page - Playwright Page instance. Must already be at `PROD_URL`.
 * @param subPath - Optional admin sub-route slug to navigate to after reaching
 *   the admin shell (e.g. `'billing'`, `'sites'`). When omitted, stops at the
 *   admin root.
 *
 * @example
 * ```ts
 * await page.goto(process.env.PROD_URL!);
 * await gotoAdmin(page, 'billing');
 * await expect(page.locator('[data-testid="billing-section"]')).toBeVisible();
 * ```
 */
export async function gotoAdmin(
  page: Page,
  subPath?: string,
): Promise<void> {
  // Sign in if not already authenticated
  const isAuthed = await page.evaluate(() => {
    return localStorage.getItem('ps_session') !== null;
  });

  if (!isAuthed) {
    await signInAsTestUser(page);
  }

  // Navigate to the admin shell via the sidebar "Admin" / "Dashboard" link
  const adminNavLink = page.locator(
    '[data-testid="nav-admin"], [data-testid="sidebar-admin-link"]',
  );

  if (await adminNavLink.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
    await adminNavLink.first().click();
  } else {
    // Fallback: the SPA may route via URL hash or query param on initial load
    await page.evaluate((path) => {
      const w = window as unknown as Record<string, unknown>;
      const nav = w.navigateTo as ((s: string) => void) | undefined;
      if (typeof nav === 'function') nav(path ?? 'admin');
    }, subPath ? `admin/${subPath}` : 'admin');
  }

  // Wait for the admin shell to appear
  await page.waitForSelector(
    '[data-testid="admin-shell"], #admin-section, [class*="admin"]',
    { timeout: 15_000 },
  );

  // If a sub-path was requested, navigate to it via sidebar clicks
  if (subPath) {
    const subLink = page.locator(`[data-testid="admin-nav-${subPath}"]`);
    if (await subLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await subLink.click();
      await page.waitForSelector(`[data-testid="${subPath}-section"], [data-testid="${subPath}-panel"]`, {
        timeout: 10_000,
      }).catch(() => {
        // Section may not have a testid yet — continue without failing
      });
    }
  }
}

// Re-export constants for use by sibling helpers
export { DEFAULT_TEST_EMAIL, DEFAULT_TEST_PASSWORD, STUB_TOKEN, STUB_USER };
