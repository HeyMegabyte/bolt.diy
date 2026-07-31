/**
 * E2E tests for authentication flows against the CURRENT Angular product:
 * the Better Auth sign-in page (/signin), magic-link send, session
 * persistence (localStorage `ps_session`), sign-out, and the `/?token&email`
 * auth-callback handoff.
 *
 * Modernized 2026-07-31 — the original suite targeted the DELETED vanilla
 * homepage (public/index.html, removed in 91182ec2) and probed window
 * functions (sendMagicLink/saveSession/clearSession) that no longer exist.
 * Every test now exercises the CONTRACT through real UI + localStorage:
 *
 *  - Sign-in page:  frontend/src/app/pages/auth/sign-in.component.ts
 *    (testids sign-in-page/-email/-password/-submit/-magic-link/-error/-magic-sent)
 *  - Magic link:    POST /api/auth/sign-in/magic-link (Better Auth — NOT the
 *    legacy /api/auth/magic-link)
 *  - Session model: localStorage `ps_session` = { token, identifier, createdAt }
 *    with a 7-day TTL (frontend/src/app/services/auth.service.ts)
 *  - Auth callback: /?token=…&email=… → AppComponent.handleAuthCallback →
 *    setSession + URL scrub + navigate to /admin
 *
 * Determinism: a benign catch-all over all API paths is registered FIRST in
 * every test (Playwright matches routes in reverse registration order, so it
 * fires LAST) — no unstubbed authed GET can ever reach prod with a fake
 * bearer. Mirrors e2e/helpers/auth.ts `_stubAdminApis`. No `networkidle`
 * anywhere — domcontentloaded + explicit locator waits only.
 */
import { type Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_EMAIL = 'test@example.com';
const STUB_TOKEN = 'e2e-authspec-stub-token';

/** 7-day session TTL from auth.service.ts SESSION_TTL_MS. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Benign API stubs so no request reaches real backends with fake credentials.
 *
 * The catch-all is registered FIRST so it matches LAST — specific routes
 * registered after it win. `/api/auth/get-session` gets an explicit `{}`
 * fulfil: the sign-in page's BA-cookie bridge (ngOnInit) probes it and a
 * `{}` body (no `user.email`) keeps the bridge inert so tests stay on
 * /signin deterministically.
 */
async function stubApis(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const method = route.request().method();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: method === 'GET' ? '{"data":[]}' : '{"ok":true}',
    });
  });

  await page.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

/**
 * Collects page console errors, filtering known harness noise (favicon
 * fetches + the 'Failed to load resource' lines produced by the fixtures'
 * CDN-blocking route aborts).
 */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon/i.test(text)) return;
    if (/failed to load resource/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

/** Seeds a `ps_session` blob before any app script runs. */
async function seedSession(
  page: Page,
  session: { token: string; identifier: string; createdAt: number },
): Promise<void> {
  await page
    .context()
    .addInitScript((s: { token: string; identifier: string; createdAt: number }) => {
      localStorage.setItem('ps_session', JSON.stringify(s));
    }, session);
}

/** Navigates to /signin and waits for the sign-in surface to render. */
async function gotoSignIn(page: Page): Promise<void> {
  await page.goto('/signin', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('sign-in-page')).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// Sign-In Screen (/signin — Better Auth surface)
// ---------------------------------------------------------------------------

test.describe('Sign-In Screen', () => {
  test('renders the sign-in page at /signin with zero console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await stubApis(page);
    await gotoSignIn(page);

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    expect(errors, `Console errors on /signin: ${errors.join(' | ')}`).toEqual([]);
  });

  test('has email + password fields with a submit gated on validity', async ({ page }) => {
    await stubApis(page);
    await gotoSignIn(page);

    const email = page.getByTestId('sign-in-email');
    const password = page.getByTestId('sign-in-password');
    const submit = page.getByTestId('sign-in-submit');

    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    // Empty form → canSubmit() false → button disabled (deep value-domain
    // coverage lives in value-domains-auth.spec.ts; this is the shell contract).
    await expect(submit).toBeDisabled();

    await email.fill(TEST_EMAIL);
    await password.fill('hunter2-valid');
    await expect(submit).toBeEnabled();
  });

  test('offers Google (and GitHub) OAuth pointed at the worker auth endpoints', async ({ page }) => {
    await stubApis(page);
    await gotoSignIn(page);

    const google = page.getByTestId('sign-in-google');
    await expect(google).toBeVisible();
    await expect(google).toHaveAttribute('href', /\/api\/auth\/google/);

    const github = page.getByTestId('sign-in-github');
    await expect(github).toBeVisible();
    await expect(github).toHaveAttribute('href', /\/api\/auth\/github/);
  });

  test('has a magic-link option gated on a valid email', async ({ page }) => {
    await stubApis(page);
    await gotoSignIn(page);

    const magicBtn = page.getByTestId('sign-in-magic-link');
    await expect(magicBtn).toBeVisible();
    // No email entered → emailValid() false → button disabled.
    await expect(magicBtn).toBeDisabled();

    await page.getByTestId('sign-in-email').fill(TEST_EMAIL);
    await expect(magicBtn).toBeEnabled();
  });

  // Replaces the vanilla page's "back to search" contract: the modern escape
  // affordance out of /signin is the "Create an account" cross-link.
  test('create-account link routes out of /signin to sign-up', async ({ page }) => {
    await stubApis(page);
    await gotoSignIn(page);

    await page.getByTestId('sign-in-to-sign-up').click();
    await page.waitForURL(/\/auth\/sign-up/, { timeout: 10_000 });
    await expect(page.getByTestId('sign-up-page')).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Magic Link Flow (Better Auth endpoint)
// ---------------------------------------------------------------------------

test.describe('Magic Link Flow', () => {
  test('sending a magic link POSTs the Better Auth endpoint and flips to sent state', async ({ page }) => {
    await stubApis(page);

    let magicLinkCalled = false;
    let bodySent: { email?: string; callbackURL?: string } = {};
    // Better Auth path — NOT the legacy /api/auth/magic-link.
    await page.route('**/api/auth/sign-in/magic-link', async (route) => {
      magicLinkCalled = true;
      expect(route.request().method()).toBe('POST');
      bodySent = route.request().postDataJSON() as { email?: string; callbackURL?: string };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: true }),
      });
    });

    await gotoSignIn(page);
    await page.getByTestId('sign-in-email').fill(TEST_EMAIL);
    await page.getByTestId('sign-in-magic-link').click();

    // Sent-state banner is the user-visible proof the request fired.
    const sent = page.getByTestId('sign-in-magic-sent');
    await expect(sent).toBeVisible({ timeout: 10_000 });
    await expect(sent).toContainText(TEST_EMAIL);

    expect(magicLinkCalled).toBe(true);
    expect(bodySent.email).toBe(TEST_EMAIL);
    // Component always ships a sanitized post-sign-in destination.
    expect(bodySent.callbackURL).toBe('/admin');
  });

  test('magic link failure surfaces the error alert', async ({ page }) => {
    await stubApis(page);
    await page.route('**/api/auth/sign-in/magic-link', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Too many magic links. Try again soon.' }),
      });
    });

    await gotoSignIn(page);
    await page.getByTestId('sign-in-email').fill(TEST_EMAIL);
    await page.getByTestId('sign-in-magic-link').click();

    const alert = page.getByTestId('sign-in-error');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText('Too many magic links');
    await expect(page.getByTestId('sign-in-magic-sent')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Session Persistence (localStorage `ps_session` contract)
// ---------------------------------------------------------------------------

test.describe('Session Persistence', () => {
  test('seeded ps_session {token,identifier,createdAt} unlocks /admin', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedSession(page, {
      token: STUB_TOKEN,
      identifier: TEST_EMAIL,
      createdAt: Date.now(),
    });
    await stubApis(page);

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    // Auth guard accepted the session → admin shell mounts, no /signin bounce.
    await expect(page.locator('app-admin, [data-cockpit="v2"]').first()).toBeVisible({
      timeout: 20_000,
    });
    expect(new URL(page.url()).pathname.startsWith('/admin')).toBe(true);
    expect(errors, `Console errors on /admin: ${errors.join(' | ')}`).toEqual([]);
  });

  test('expired ps_session (>7-day TTL) is rejected — guard bounces to /signin', async ({ page }) => {
    await seedSession(page, {
      token: STUB_TOKEN,
      identifier: TEST_EMAIL,
      // One day past the TTL → AuthService.isLoggedIn() false on read.
      createdAt: Date.now() - SESSION_TTL_MS - 24 * 60 * 60 * 1000,
    });
    await stubApis(page);

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/signin/, { timeout: 15_000 });
    await expect(page.getByTestId('sign-in-page')).toBeVisible({ timeout: 10_000 });
    // Guard preserves the intended destination for post-sign-in return.
    expect(page.url()).toContain('returnUrl');
  });

  test('sign out from the admin avatar menu clears ps_session and leaves /admin', async ({ page }) => {
    await seedSession(page, {
      token: STUB_TOKEN,
      identifier: TEST_EMAIL,
      createdAt: Date.now(),
    });
    await stubApis(page);

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('app-admin, [data-cockpit="v2"]').first()).toBeVisible({
      timeout: 20_000,
    });

    // Real user path: avatar → menu → Sign out. AdminStateService.signOut()
    // fires POST /api/auth/sign-out fire-and-forget (swallowed by the
    // catch-all), clears the local session, and navigates home.
    await page.getByTestId('user-avatar-btn').click();
    await expect(page.getByTestId('user-menu')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('user-menu-signout').click();

    await page.waitForFunction(() => localStorage.getItem('ps_session') === null, undefined, {
      timeout: 10_000,
    });
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Auth Callback Handling (/?token&email handoff)
// ---------------------------------------------------------------------------

test.describe('Auth Callback Handling', () => {
  test('auth callback with token+email mints ps_session and lands on /admin', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    // Catch-all FIRST — post-callback the app navigates to /admin and fires
    // authed GETs; none may reach prod with the fake callback bearer.
    await stubApis(page);

    const cbToken = 'e2e-callback-token-abc';
    await page.goto(
      `/?token=${encodeURIComponent(cbToken)}&email=${encodeURIComponent(TEST_EMAIL)}`,
      { waitUntil: 'domcontentloaded' },
    );

    // AppComponent.handleAuthCallback stores the session…
    await page.waitForFunction(() => localStorage.getItem('ps_session') !== null, undefined, {
      timeout: 15_000,
    });
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem('ps_session');
      return raw
        ? (JSON.parse(raw) as { token: string; identifier: string; createdAt?: number })
        : null;
    });
    expect(stored).not.toBeNull();
    expect(stored?.token).toBe(cbToken);
    // Session shape is {token, identifier, createdAt} — NOT the legacy {token, email}.
    expect(stored?.identifier).toBe(TEST_EMAIL);
    expect(typeof stored?.createdAt).toBe('number');

    // …scrubs the token from the URL and navigates to the admin dashboard.
    await page.waitForURL(/\/admin/, { timeout: 15_000 });
    expect(page.url()).not.toContain('token=');
    expect(errors, `Console errors during auth callback: ${errors.join(' | ')}`).toEqual([]);
  });

  // RETIRED: "billing return with ?billing=success is handled" — nothing in
  // frontend/src/app reads a `billing` query param anymore (verified via grep
  // 2026-07-31: billing.component.ts consumes only `?tab`; Stripe returns land
  // on /admin/billing). The handler lived in the deleted vanilla homepage
  // (public/index.html, removed in 91182ec2).
});
