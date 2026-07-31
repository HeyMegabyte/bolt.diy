/**
 * @module e2e/helpers/auth
 * @description Real-user auth helpers for E2E tests against projectsites.dev.
 *
 * The AuthService reads `localStorage.ps_session` expecting the Session shape:
 *   { token: string, identifier: string, createdAt?: number }
 * The auth guard calls `AuthService.isLoggedIn()` which is true when the
 * parsed session is non-null AND not expired (7-day TTL from createdAt).
 *
 * Three authentication pathways, tried in order:
 *
 * **Pathway A — E2E_API_KEY (preferred)**
 * `ps_test_…` org-scoped API key for the e2e-test-org. Injects via
 * `addInitScript` so it's in localStorage before the SPA boots.
 * `/api/auth/me` returns the REAL test user — no stubs needed.
 *
 * **Pathway B — stub (default fallback)**
 * Injects a fake session + stubs `/api/auth/me` and critical admin data
 * endpoints so the SPA sees a signed-in user without a real token.
 *
 * **Pathway C — real magic-link round-trip (future)**
 * Requires the worker to expose `GET /api/auth/magic-link/peek?email=...`
 * (a test-only endpoint guarded by `env.E2E_PEEK_SECRET`).
 *
 * @example
 * ```ts
 * import { signInAsTestUser, gotoAdmin } from './helpers/auth.js';
 *
 * test('admin renders', async ({ page }) => {
 *   await signInAsTestUser(page);
 *   await gotoAdmin(page, 'feature-flags');
 *   await expect(page.locator('app-admin-feature-flags')).toBeVisible();
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

/** Fake session token used by Pathway B (stub). */
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
 * Sets up page.route interceptors for admin API endpoints so the SPA
 * doesn't 401/404 on data fetches after navigating to /admin.
 *
 * Call BEFORE navigating to the admin URL — routes persist across
 * navigations on the same page.
 */
async function _stubAdminApis(page: Page, email: string): Promise<void> {
  // LAST-RESORT catch-all — registered FIRST so Playwright matches it LAST
  // (routes match in reverse registration order). Any /api/* request no other
  // handler stubbed gets a benign 200 here instead of reaching real prod.
  // Load-bearing: the admin shell fires /api/audit/rows + /api/inbox/tasks on
  // boot; with a fake bearer those 401 and ApiService then CLEARS the session
  // and bounces to /signin mid-test. No admin journey survives without this.
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: method === 'GET' ? '{"data":[]}' : '{"ok":true}',
    });
  });

  // Stub /api/auth/me — the admin component calls this to verify the session.
  // Without it, the fake token gets 401 and the admin shows a "Sign In" prompt.
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: { ...STUB_USER, email, org_id: 'e2e-test-org', is_super_admin: true },
      }),
    });
  });

  await page.route('**/api/sites**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [], meta: { total: 0 } }),
    });
  });

  await page.route('**/api/admin/domains/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ domains: [], total: 0 }),
    });
  });

  await page.route('**/api/billing/subscription', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ plan: 'pro', status: 'active' }),
    });
  });

  await page.route('**/api/billing/entitlements', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ features: {} }),
    });
  });

  // /api/feature-flags is PUBLIC + anonymous-safe — let it hit REAL prod so
  // flag-gated sections render their true prod state (a hardcoded flag map
  // lies: flags:{} turns every gated section into a "not enabled" notice and
  // manufactures false test failures). continue() is terminal + safe here.
  await page.route('**/api/feature-flags**', (route) => route.continue());

  await page.route('**/api/analytics/track', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Super-admin endpoints the feature-flags component calls
  await page.route('**/api/super-admin/feature-flags', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flags: [], count: 0 }),
    });
  });

  // Catch-all for other API calls — return empty success so nothing 401s
  await page.route('**/api/admin/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/**
 * Inject session via BrowserContext.addInitScript which fires BEFORE
 * scripts on EVERY page in the context — including the very first
 * navigation. This is the most reliable injection method because it
 * doesn't depend on prior navigation state.
 *
 * Session shape MUST match AuthService Session interface:
 *   { token: string, identifier: string, createdAt: number }
 */
async function _injectSession(
  page: Page,
  _prodUrl: string,
  token: string,
  identifier: string,
): Promise<void> {
  // Use context-level addInitScript — fires before scripts on every page,
  // including the first one. More reliable than page.addInitScript.
  await page.context().addInitScript(
    ({ t, id }: { t: string; id: string }) => {
      // Set session BEFORE Angular boots on any page in this context
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: t, identifier: id, createdAt: Date.now() }),
      );
    },
    { t: token, id: identifier },
  );
}

/**
 * Performs a real magic-link round-trip using the worker's test-peek endpoint.
 *
 * @internal
 * @remarks **TODO**: Wire once the worker ships the peek endpoint.
 */
async function _realMagicLinkSignIn(
  page: Page,
  prodUrl: string,
  email: string,
): Promise<void> {
  const peekSecret = process.env.E2E_PEEK_SECRET ?? '';

  await page.goto(`${prodUrl}/`);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    const nav = w.navigateTo as (s: string) => void;
    if (typeof nav === 'function') nav('signin');
  });

  await page.locator('[onclick*="showSigninPanel(\'email\')"]').click();
  await page.locator('#email-input').fill(email);
  const sendBtn = page.locator('[onclick*="sendMagicLink"]').first();
  await sendBtn.click();

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
    await page.waitForTimeout(1_000);
  }

  if (!token) {
    throw new Error(
      `[auth.ts] Timed out waiting for magic-link token for ${email}.`,
    );
  }

  await page.goto(
    `${prodUrl}/?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
  );
  await page.waitForFunction(
    () => localStorage.getItem('ps_session') !== null,
    { timeout: 10_000 },
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Signs in as the E2E test user.
 *
 * Pathway priority:
 * 1. `E2E_API_KEY` env var → real API key injected via addInitScript
 * 2. `STUB_AUTH=0` → real magic-link round-trip (requires worker peek endpoint)
 * 3. Default → stub session + stubbed API endpoints
 *
 * After this call, `localStorage.ps_session` is populated and the SPA
 * will see an authenticated user on the next navigation.
 *
 * @param page - Playwright Page instance.
 * @param opts.email - Override test email (default: `E2E_USER_EMAIL` env).
 */
export async function signInAsTestUser(
  page: Page,
  opts?: { email?: string },
): Promise<void> {
  const email = opts?.email ?? DEFAULT_TEST_EMAIL;
  const prodUrl = process.env.PROD_URL ?? 'https://projectsites.dev';
  const useRealAuth = process.env.STUB_AUTH === '0';

  // Pathway A — REAL API key (preferred)
  const apiKey = process.env.E2E_API_KEY;
  if (apiKey) {
    await _injectSession(page, prodUrl, apiKey, email);
    // Real API key → real /api/auth/me, no stubs needed for auth
    // But we still stub admin data APIs so skeletons transition
    await _stubAdminApis(page, email);
    return;
  }

  if (useRealAuth) {
    // Pathway C — real magic-link round-trip
    await _realMagicLinkSignIn(page, prodUrl, email);
  } else {
    // Pathway B — stub (safe default)
    await _injectSession(page, prodUrl, STUB_TOKEN, email);
    await _stubAdminApis(page, email);
  }
}

/**
 * Signs out the currently authenticated user.
 */
export async function signOut(page: Page): Promise<void> {
  const avatarTrigger = page.locator(
    '[data-testid="user-avatar"], [data-testid="account-menu-trigger"]',
  );
  await avatarTrigger.first().click();

  const signOutBtn = page.locator(
    '[data-testid="sign-out-btn"], [onclick*="logout"], text="Sign out"',
  );
  await signOutBtn.first().click();

  await page.waitForFunction(
    () => localStorage.getItem('ps_session') === null,
    { timeout: 10_000 },
  );
}

/**
 * Navigates to the admin panel (or a sub-route) after ensuring the user
 * is authenticated. Uses `page.goto` for the admin navigation since the
 * session is injected before the SPA boots.
 *
 * @param page - Playwright Page instance.
 * @param subPath - Optional admin sub-route (e.g. `'billing'`, `'feature-flags'`).
 */
export async function gotoAdmin(
  page: Page,
  subPath?: string,
): Promise<void> {
  const prodUrl = process.env.PROD_URL ?? 'https://projectsites.dev';
  const targetPath = subPath ? `/admin/${subPath}` : '/admin';

  // Navigate to admin — session was already injected by signInAsTestUser
  // on this origin, so the auth guard will find it and allow access
  await page.goto(`${prodUrl}${targetPath}`, { waitUntil: 'domcontentloaded' });

  // If we still ended up on /signin, the session injection failed
  const currentUrl = page.url();
  if (currentUrl.includes('/signin')) {
    const raw = await page.evaluate(() => localStorage.getItem('ps_session'));
    throw new Error(
      `Auth guard redirected to /signin. ` +
      `localStorage.ps_session raw: ${raw?.substring(0, 80)}... ` +
      `The session injection in signInAsTestUser may not have persisted.`,
    );
  }

  // Wait for the admin shell to render
  await page.waitForSelector('app-admin, [data-cockpit="v2"]', {
    timeout: 20_000,
  });

  // If a sub-path was requested, the Angular router should have loaded
  // it since we navigated directly to /admin/<subPath>
  if (subPath) {
    // Try clicking the sidebar nav link for the sub-section
    const subLink = page.locator(`[data-testid="admin-nav-${subPath}"]`);
    const visible = await subLink.isVisible({ timeout: 3_000 }).catch(() => false);
    if (visible) {
      await subLink.click();
      await page
        .waitForSelector(
          `[data-testid="${subPath}-section"], [data-testid="${subPath}-panel"]`,
          { timeout: 10_000 },
        )
        .catch(() => {
          // Section may not have a testid yet — continue
        });
    }
  }
}

/**
 * The email address that passes the `sysAdminGuard` protecting
 * `/admin/feature-flags` and other operator-only routes.
 *
 * The default stub email (`test@megabyte.space` / `E2E_USER_EMAIL`) is NOT
 * in `SYS_ADMIN_EMAILS` — it will be redirected to `/admin/site-features` by
 * `sysAdminGuard`. Any spec that navigates to a sysAdmin-guarded route MUST
 * override the email:
 *
 * ```ts
 * import { signInAsTestUser, SYS_ADMIN_TEST_EMAIL } from './helpers/auth.js';
 *
 * await signInAsTestUser(page, { email: SYS_ADMIN_TEST_EMAIL });
 * ```
 *
 * Source of truth: `frontend/src/app/pages/admin/sys-admin.ts`
 * `SYS_ADMIN_EMAILS = ['brian@megabyte.space', 'hey@megabyte.space']`
 */
export const SYS_ADMIN_TEST_EMAIL = 'brian@megabyte.space';

// Re-export constants for sibling helpers
export { DEFAULT_TEST_EMAIL, DEFAULT_TEST_PASSWORD, STUB_TOKEN, STUB_USER };
