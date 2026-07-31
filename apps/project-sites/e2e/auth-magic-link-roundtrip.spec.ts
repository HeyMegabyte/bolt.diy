/**
 * @file auth-magic-link-roundtrip.spec.ts
 * @description Crown-jewel real-auth E2E: NO route stubs — uses the production
 *   peek endpoint to complete a genuine magic-link round trip, then exercises
 *   the real admin shell with real /api data.
 *
 * Requires E2E_PEEK_SECRET env var (dark-404 without it → skip).
 *
 * Email flow: TWO real emails per run to `test@megabyte.space` (one per serial
 * auth test). With the `better_auth` flag ON (prod state), the send goes
 * through POST /api/auth/sign-in/magic-link (the exact endpoint the /signin
 * UI uses); the BA sendMagicLink hook stashes the FULL verify URL in KV and
 * the peek seam returns it as `{url}`. Consuming it exercises the REAL login
 * chain: BA verify → cookie session → 302 /admin → guard bounce → /signin
 * BA-cookie bridge mints ps_session → lands authenticated in /admin.
 *
 * Run (manual only — real emails):
 *   E2E_PEEK_SECRET=$SECRET npx playwright test \
 *     --config=playwright.prod-roundtrip.config.ts --workers=1
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';
const PEEK_SECRET = process.env.E2E_PEEK_SECRET ?? '';
const TEST_EMAIL = 'test@megabyte.space';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Post a magic-link request for the given email via the real API — the SAME
 * endpoint the /signin UI posts to (Better Auth `/sign-in/magic-link`).
 *
 * Uses page.evaluate(fetch(...)) instead of page.request.post() to bypass
 * Cloudflare Bot Fight Mode (BFM): page.request runs outside the browser's
 * challenge-solved cookie context (403 + JS challenge). fetch() inside
 * page.evaluate runs in the browser's context, carrying CF challenge cookies.
 */
async function requestMagicLink(page: Page, email: string): Promise<void> {
  const result = await page.evaluate(
    async ({ url, emailAddr }: { url: string; emailAddr: string }) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailAddr, callbackURL: '/admin' }),
      });
      let bodyText = '';
      try { bodyText = await r.text(); } catch { /* ignore */ }
      return { ok: r.ok, status: r.status, bodyText };
    },
    { url: `${PROD_URL}/api/auth/sign-in/magic-link`, emailAddr: email },
  );
  expect(
    result.ok,
    `POST /api/auth/sign-in/magic-link returned ${result.status}: ${result.bodyText.slice(0, 200)}`,
  ).toBe(true);
}

/**
 * Poll the peek endpoint until a verify link is returned (or the deadline
 * hits). Returns `{url}` (Better Auth full verify URL — the flag-ON path) or
 * `{token}` (legacy stash — flag-OFF fallback). page.request needs no
 * navigation; the peek route is passthrough'd around the BA handler.
 */
async function peekLink(page: Page, email: string): Promise<{ url?: string; token?: string }> {
  const deadline = Date.now() + 25_000;
  const peekUrl = `${PROD_URL}/api/auth/magic-link/peek?email=${encodeURIComponent(email)}&secret=${encodeURIComponent(PEEK_SECRET)}`;

  while (Date.now() < deadline) {
    const res = await page.request.get(peekUrl);
    if (res.ok()) {
      const json = (await res.json()) as { token?: string | null; url?: string | null };
      if (json.url) return { url: json.url };
      if (json.token) return { token: json.token };
    }
    // 1 s interval — not a sleep, just a short wait between polls
    await new Promise<void>((r) => setTimeout(r, 1_000));
  }
  throw new Error(`[peek] Timed out waiting for magic-link link for ${email}`);
}

/**
 * Consume the peeked link exactly as the email click would.
 *
 * Better Auth path (`url`): BA verify sets the cookie session and 302s to the
 * callbackURL (/admin). The guard sees no ps_session and bounces to
 * /signin?returnUrl=%2Fadmin, where the SignIn component's BA-cookie bridge
 * probes /api/auth/get-session, mints ps_session, and navigates back to
 * /admin — the REAL production login chain, end to end.
 *
 * Legacy path (`token`): GET /api/auth/magic-link/verify 302s to
 * `/?token=…&email=…` and AppComponent stores the session from URL params.
 */
async function completeVerify(page: Page, link: { url?: string; token?: string }): Promise<void> {
  const verifyUrl =
    link.url ?? `${PROD_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(link.token ?? '')}`;
  // coordinator hint: this SPA never settles to networkidle — domcontentloaded avoids hang
  await page.goto(verifyUrl, { waitUntil: 'domcontentloaded' });

  // Wait for ps_session to appear — via URL-param handoff (legacy) or the
  // /signin BA-cookie bridge (Better Auth). The bridge adds one get-session
  // round trip plus a router hop, hence the generous timeout.
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem('ps_session');
      if (!raw) return false;
      try {
        const parsed = JSON.parse(raw) as { token?: string };
        return typeof parsed.token === 'string' && parsed.token.length > 0;
      } catch {
        return false;
      }
    },
    { timeout: 25_000 },
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe.serial('magic-link real round-trip (no stubs)', () => {
  // Skip the whole suite cleanly when the peek seam is not armed.
  test.skip(!PEEK_SECRET, 'needs E2E_PEEK_SECRET env var — skipping peek-gated tests');

  test('1 — full round trip: request → peek → verify → real session in /admin', async ({
    page,
  }) => {
    // 1a. Start at homepage as anonymous user.
    await page.goto(`${PROD_URL}/`, { waitUntil: 'domcontentloaded' });

    // 1b. POST magic-link via the real API.
    await requestMagicLink(page, TEST_EMAIL);

    // 1c. Poll peek endpoint until the verify link is available (KV stash ~1 s).
    const link = await peekLink(page, TEST_EMAIL);
    expect(link.url ?? link.token, 'peek returned neither url nor token').toBeTruthy();

    // 1d. Complete verification via the real verify flow (BA url or legacy token).
    await completeVerify(page, link);

    // 1e. Assert ps_session is set in localStorage.
    const rawSession = await page.evaluate(() => localStorage.getItem('ps_session'));
    expect(rawSession, 'ps_session not set after magic-link verify').toBeTruthy();
    const session = JSON.parse(rawSession ?? '{}') as { token?: string; identifier?: string };
    expect(session.token, 'session.token is missing').toBeTruthy();
    expect(session.identifier, 'session.identifier is missing').toBeTruthy();

    // 1f. Navigate to /admin with the REAL session — no stubs at all.
    await page.goto(`${PROD_URL}/admin`, { waitUntil: 'domcontentloaded' });

    // 1g. The Angular auth guard should allow access (real /api/auth/me succeeds).
    //     Wait for the admin shell to render — the cockpit or app-admin element.
    await expect(
      page.locator('app-admin, [data-cockpit="v2"]').first(),
    ).toBeVisible({ timeout: 25_000 });

    // 1h. Assert the URL did NOT redirect to /signin (real session accepted).
    expect(page.url(), 'auth guard redirected away from /admin').not.toContain('/signin');

    // 1i. Assert real /api/auth/me returned data — the user avatar/menu appears.
    //     data-testid="user-avatar-btn" is rendered by the admin shell once me() resolves.
    await expect(page.locator('[data-testid="user-avatar-btn"]')).toBeVisible({
      timeout: 15_000,
    });

    // 1j. Screenshot the real signed-in admin.
    await page.screenshot({
      path: 'test-results-p7-roundtrip/01-real-session-admin.png',
      fullPage: false,
    });

    console.warn('[roundtrip] Test 1 passed — real session rendered real admin data.');
  });

  test('2 — sign-out flow: real sign-out clears session + bounces to homepage/signin', async ({
    page,
  }) => {
    // 2a. Re-establish the real session for this test.
    //     Serial tests don't share pages, so we POST + peek + verify again.
    //     The magic-link token is single-use, so we must request a new one.
    await page.goto(`${PROD_URL}/`, { waitUntil: 'domcontentloaded' });

    await requestMagicLink(page, TEST_EMAIL);
    const link2 = await peekLink(page, TEST_EMAIL);
    await completeVerify(page, link2);

    // 2b. Navigate to /admin with the real session.
    await page.goto(`${PROD_URL}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.locator('app-admin, [data-cockpit="v2"]').first(),
    ).toBeVisible({ timeout: 25_000 });

    // 2c. Open the user avatar menu.
    const avatarBtn = page.locator('[data-testid="user-avatar-btn"]');
    await expect(avatarBtn).toBeVisible({ timeout: 10_000 });
    await avatarBtn.click();

    // 2d. Wait for the user menu to be visible.
    // The menu may use data-testid="user-menu" or a generic menu container.
    // Try the menu signout button directly since it will appear when the menu opens.
    const signoutBtn = page.locator('[data-testid="user-menu-signout"]');
    await expect(signoutBtn).toBeVisible({ timeout: 5_000 });

    // 2e. Click sign out.
    await signoutBtn.click();

    // 2f. Wait for ps_session to be cleared from localStorage.
    await page.waitForFunction(
      () => localStorage.getItem('ps_session') === null,
      { timeout: 10_000 },
    );

    // 2g. Assert the session is gone.
    const rawAfterSignout = await page.evaluate(() => localStorage.getItem('ps_session'));
    expect(rawAfterSignout, 'ps_session still set after sign-out').toBeNull();

    // 2h. The app should have navigated away from /admin (to / or /signin).
    await page.waitForFunction(
      () => !window.location.pathname.startsWith('/admin'),
      { timeout: 10_000 },
    );
    const urlAfterSignout = page.url();
    const onPublicPage =
      urlAfterSignout.includes('/signin') ||
      urlAfterSignout === `${PROD_URL}/` ||
      urlAfterSignout === `${PROD_URL}`;
    expect(onPublicPage, `Expected redirect to homepage/signin, got ${urlAfterSignout}`).toBe(true);

    await page.screenshot({
      path: 'test-results-p7-roundtrip/02-signed-out.png',
      fullPage: false,
    });
    console.warn('[roundtrip] Test 2 passed — real sign-out cleared session.');
  });

  test('3 — wrong peek secret returns 404', async ({ page }) => {
    // This is a request-level test — every E2E starts at homepage.
    await page.goto(`${PROD_URL}/`, { waitUntil: 'domcontentloaded' });

    const badSecretUrl = `${PROD_URL}/api/auth/magic-link/peek?email=${encodeURIComponent(TEST_EMAIL)}&secret=totally-wrong-secret`;
    const res = await page.request.get(badSecretUrl);
    expect(res.status(), 'wrong secret should return 404').toBe(404);
    console.warn('[roundtrip] Test 3 passed — wrong secret → 404 confirmed.');
  });
});
