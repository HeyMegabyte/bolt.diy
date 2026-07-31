/**
 * @module e2e/golden-path
 * @description End-to-end tests for the create flow golden path, modernized for
 * the Angular SPA (2026-07-31). The vanilla `public/index.html` 4-screen state
 * machine was deleted; `/` now serves the Angular shell and the flow lives in
 * real routes: `/` (homepage hero search) → `/signin` (Better Auth UI) →
 * `/create` (wizard) → `/waiting?id=…&slug=…` (build progress).
 *
 * Page tests run against PROD_URL with EVERY `/api/*` request intercepted
 * (benign catch-all + specific stubs) so nothing mutates prod. Request-level
 * tests use the config baseURL (local mock `scripts/e2e_server.cjs` or prod).
 *
 * ── Retired vanilla-era tests (with citations) ─────────────────────────────
 * - "Existing published site redirects to live URL" + "Queued/building site
 *   goes directly to waiting": RETIRED — `lookupSite` (frontend
 *   api.service.ts:292) has ZERO callers; `SearchComponent.selectItem`
 *   (search.component.ts:193-218) and `HomepageComponent.selectItem` route
 *   every result to /create (authed) or /signin (guest). No lookup→redirect
 *   branch exists in the Angular flow.
 * - 4-screen `#screen-*` assertions, `window.state`, `window.redirectTo`,
 *   `sessionStorage.ps_pending_build` auto-submit choreography: RETIRED —
 *   vanilla homepage deleted; SPA router owns navigation.
 * - Request-level POST `/api/auth/magic-link` (legacy) assertions: RETIRED —
 *   mutation-unsafe against prod (would email) and Cloudflare BFM challenges
 *   request-context POSTs with 403 HTML (verified 2026-07-31). The UI now
 *   posts Better Auth `/api/auth/sign-in/magic-link` (auth-api.service.ts:150),
 *   covered here with a stub.
 * - Oversized-payload 413 duplicate: consolidated into e2e/health.spec.ts.
 *
 * ── Surviving contracts, modernized ────────────────────────────────────────
 * - Search input + results dropdown + "Build a custom website" option.
 * - Details form (now /create): required name+address, context textarea.
 * - Email branch (magic link, stubbed) incl. the email value-domain trio.
 * - Google branch (`<a href="/api/auth/google?returnUrl=…">`), intercepted.
 * - Waiting screen after a stubbed build POST; building → published states.
 * - `/?token=…&email=…&auth_callback=…` session-mint callback
 *   (app.component.ts:339-354).
 *
 * @packageDocumentation
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';
const PROD_HOST = new URL(PROD_URL).hostname;

// The SPA registers an Angular service worker on prod; block it so page.route
// interception sees every request (same discipline as the admin journeys).
test.use({ serviceWorkers: 'block' });

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Abort third-party requests (GTM, PostHog, Turnstile, fonts) so page loads
 * never hang on unreachable CDNs. App-origin + localhost stay allowed.
 */
async function blockThirdParty(page: Page): Promise<void> {
  await page.route(
    (url) =>
      url.hostname !== PROD_HOST &&
      !url.hostname.endsWith(`.${PROD_HOST}`) &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1',
    (route) => route.abort(),
  );
}

/**
 * Stub the API surface the create flow touches. The benign catch-all is
 * registered FIRST so Playwright matches it LAST (reverse registration
 * order) — any unstubbed authed GET lands on a harmless 200 instead of
 * reaching real prod (helpers/auth.ts pattern; without it, boot-time calls
 * 401 with a fake bearer and ApiService clears the session mid-test).
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

  // Business search — echoes the query like the e2e mock server contract.
  await page.route('**/api/search/businesses**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? 'Test';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            place_id: 'ChIJ_e2e_1',
            name: `${q} Pizza`,
            address: '123 Main St, New York, NY',
            types: ['restaurant'],
          },
          {
            place_id: 'ChIJ_e2e_2',
            name: `${q} Plumbing`,
            address: '456 Oak Ave, Brooklyn, NY',
            types: ['plumber'],
          },
        ],
      }),
    });
  });

  // Pre-built site search — empty so Google Places results lead the dropdown.
  await page.route('**/api/sites/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"data":[]}',
    });
  });

  // Better Auth cookie-session probe (sign-in ngOnInit bridge) — no session.
  await page.route('**/api/auth/get-session**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // Better Auth passwordless magic link — the ONLY sign-in mutation this
  // suite exercises, always stubbed (never a real email).
  await page.route('**/api/auth/sign-in/magic-link**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"status":true}',
    });
  });
}

/**
 * Inject a fake `ps_session` before the SPA boots (AuthService shape:
 * `{ token, identifier, createdAt }` — see e2e/helpers/auth.ts). All API
 * traffic is stubbed, so the fake bearer never reaches prod.
 */
async function injectSession(page: Page, email = 'e2e-golden@megabyte.space'): Promise<void> {
  await page.context().addInitScript(
    ({ id }: { id: string }) => {
      localStorage.setItem(
        'ps_session',
        JSON.stringify({ token: 'e2e-stub-session-token', identifier: id, createdAt: Date.now() }),
      );
    },
    { id: email },
  );
}

/** Hero search input on the homepage (first match; the CTA section repeats it). */
function heroSearch(page: Page) {
  return page.getByPlaceholder('Search for your business...').first();
}

/** Open the homepage and wait for the hero to render. */
async function openHomepage(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('hero-headline')).toBeVisible({ timeout: 15_000 });
  await expect(heroSearch(page)).toBeVisible();
}

/** Type a query into the hero search and click the named dropdown result. */
async function searchAndSelect(page: Page, query: string, resultName: string | RegExp) {
  const input = heroSearch(page);
  await input.click();
  await input.pressSequentially(query, { delay: 30 });

  const result = page.getByRole('button', { name: resultName });
  await expect(result.first()).toBeVisible({ timeout: 10_000 });
  await result.first().click();
}

// ─── Guest golden path: search → select → sign-in gate ───────

test.describe('Guest golden path: homepage search → select → sign-in', () => {
  test('hero search shows stubbed results + custom option; selecting routes a guest to /signin', async ({
    page,
  }) => {
    await blockThirdParty(page);
    await stubApis(page);
    await openHomepage(page);

    // Type a business name (300ms debounce upstream of the stubbed API).
    const input = heroSearch(page);
    await input.click();
    await input.pressSequentially('Sunrise Bakery', { delay: 30 });
    await expect(input).toHaveValue('Sunrise Bakery');

    // Dropdown renders both stubbed results with addresses…
    const first = page.getByRole('button', { name: /Sunrise Bakery Pizza/ }).first();
    await expect(first).toBeVisible({ timeout: 10_000 });
    await expect(first).toContainText('123 Main St, New York, NY');
    const second = page.getByRole('button', { name: /Sunrise Bakery Plumbing/ }).first();
    await expect(second).toBeVisible();
    await expect(second).toContainText('456 Oak Ave, Brooklyn, NY');

    // …plus the always-present custom option (SearchItem type 'custom').
    const custom = page.getByRole('button', { name: /Build a custom website/ }).first();
    await expect(custom).toBeVisible();
    await expect(custom).toContainText('Enter your business details manually');

    // Selecting a result as a GUEST routes to the Better Auth sign-in surface
    // (HomepageComponent.navigateToDetailsOrSignin — no session → /signin).
    await first.click();
    await expect(page.getByTestId('sign-in-page')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/signin/);
  });
});

// ─── Sign-in: email branch (value domains + magic link) ──────

test.describe('Sign-in email branch', () => {
  test('email value domains gate the magic-link button; valid email sends the stubbed link', async ({
    page,
  }) => {
    await blockThirdParty(page);
    await stubApis(page);
    await openHomepage(page);

    // Navigate via the nav — guests see "Sign In".
    await page.getByRole('button', { name: 'Sign In' }).first().click();
    await expect(page.getByTestId('sign-in-page')).toBeVisible({ timeout: 15_000 });

    const email = page.getByTestId('sign-in-email');
    const magicBtn = page.getByTestId('sign-in-magic-link');

    // Value domain 1 — empty: button disabled, no request possible.
    await expect(magicBtn).toBeDisabled();

    // Value domain 2 — invalid format: inline error + still disabled.
    await email.fill('not-a-real-email');
    await email.blur();
    await expect(page.getByTestId('sign-in-email-error')).toBeVisible();
    await expect(magicBtn).toBeDisabled();

    // Value domain 3 — valid: enabled; click posts the Better Auth endpoint.
    await email.fill('chef@harborsushi.com');
    await expect(magicBtn).toBeEnabled();

    const reqPromise = page.waitForRequest(
      (req) => req.url().includes('/api/auth/sign-in/magic-link') && req.method() === 'POST',
    );
    await magicBtn.click();
    const req = await reqPromise;
    expect(req.postDataJSON()).toMatchObject({ email: 'chef@harborsushi.com' });

    // Confirmation state renders with the address echoed back.
    const sent = page.getByTestId('sign-in-magic-sent');
    await expect(sent).toBeVisible({ timeout: 10_000 });
    await expect(sent).toContainText('chef@harborsushi.com');
  });
});

// ─── Sign-in: Google branch (handoff contract) ───────────────

test.describe('Sign-in Google branch', () => {
  test('Google button carries the OAuth handoff URL; the endpoint redirects toward Google', async ({
    page,
  }) => {
    await blockThirdParty(page);
    await stubApis(page);

    await openHomepage(page);
    await page.getByRole('button', { name: 'Sign In' }).first().click();
    await expect(page.getByTestId('sign-in-page')).toBeVisible({ timeout: 15_000 });

    // The branch is a plain anchor (full-page handoff), not an XHR. We do NOT
    // click it: the SPA ships Speculation Rules (speculation_rules flag), and
    // Chromium prerenders the anchor target OUTSIDE page.route interception —
    // clicking activates the already-redirected prerender, bypassing every
    // stub (verified empirically 2026-07-31: catch-all caught XHRs but the
    // nav produced zero request events and landed on accounts.google.com).
    const google = page.getByTestId('sign-in-google');
    await expect(google).toBeVisible();
    const href = await google.getAttribute('href');
    expect(href).toContain('/api/auth/google?returnUrl=');

    // Assert the real handoff contract request-level instead: the worker
    // 302s toward Google's OAuth screen (no user data mutated; the CSRF
    // state row it stashes is one-shot + expiring).
    const handoff = await page.request.get(`${PROD_URL}${href}`, {
      maxRedirects: 0,
    });
    expect([301, 302, 307]).toContain(handoff.status());
    expect(handoff.headers()['location'] ?? '').toContain('accounts.google.com');
  });
});

// ─── Auth callback: token in URL mints the session ───────────

test.describe('Auth callback landing', () => {
  test('/?token=…&email=…&auth_callback=… mints ps_session and cleans the URL', async ({
    page,
  }) => {
    await blockThirdParty(page);
    await stubApis(page);

    // Surviving contract from the magic-link/Google email round-trip:
    // AppComponent reads token+email params, calls auth.setSession, then
    // strips the params (app.component.ts:339-354).
    await page.goto(
      `${PROD_URL}/?token=e2e-callback-token&email=cb%40example.com&auth_callback=email`,
      { waitUntil: 'domcontentloaded' },
    );

    await page.waitForFunction(() => localStorage.getItem('ps_session') !== null, {
      timeout: 15_000,
    });
    const session = JSON.parse(
      (await page.evaluate(() => localStorage.getItem('ps_session'))) as string,
    );
    expect(session.token).toBe('e2e-callback-token');
    expect(session.identifier).toBe('cb@example.com');

    // URL is cleaned — the one-time token never lingers in history.
    await expect(page).not.toHaveURL(/auth_callback|token=/);
  });
});

// ─── Authed golden path: search → create → build → waiting ───

test.describe('Authed golden path: search → prefilled create → build → waiting', () => {
  test('selecting a business pre-fills /create; Create site POSTs and lands on /waiting through published', async ({
    page,
  }) => {
    await blockThirdParty(page);
    await stubApis(page);
    await injectSession(page);

    // Build POST — stubbed; asserted below via waitForRequest.
    await page.route('**/api/sites/create-from-search**', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            site_id: 'site-e2e-001',
            slug: 'e2e-biz',
            status: 'building',
            workflow_instance_id: 'wf-e2e-001',
          },
        }),
      }),
    );

    // Waiting-screen polls (every 3s): site status + logs. `phase` flips after
    // the building state is asserted, driving the published transition.
    let phase: 'building' | 'published' = 'building';
    await page.route(
      (url) => url.pathname.endsWith('/api/sites/site-e2e-001'),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { id: 'site-e2e-001', slug: 'e2e-biz', status: phase } }),
        }),
    );
    await page.route(
      (url) => url.pathname.includes('/api/sites/site-e2e-001/logs'),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data:
              phase === 'published'
                ? [{ action: 'workflow.completed' }]
                : [{ action: 'workflow.started' }],
          }),
        }),
    );

    await openHomepage(page);
    await searchAndSelect(page, 'Harbor Sushi', /Harbor Sushi Pizza/);

    // Authed → straight to /create with the selection pre-filled.
    await expect(page).toHaveURL(/\/create/, { timeout: 15_000 });
    await expect(page.locator('#create-name')).toHaveValue('Harbor Sushi Pizza', {
      timeout: 10_000,
    });
    await expect(page.locator('#create-address')).toHaveValue('123 Main St, New York, NY');

    // Add context and submit.
    await page
      .locator('#create-context')
      .fill('Authentic Japanese sushi bar. Omakase menu, fresh fish daily.');

    const buildReq = page.waitForRequest(
      (req) => req.url().includes('/api/sites/create-from-search') && req.method() === 'POST',
    );
    await page.getByRole('button', { name: /Create site|Create with/ }).click();
    const posted = (await buildReq).postDataJSON() as {
      mode: string;
      business: { name: string };
    };
    expect(posted.mode).toBe('business');
    expect(posted.business.name).toBe('Harbor Sushi Pizza');

    // Waiting screen — building state.
    await expect(page).toHaveURL(/\/waiting\?.*id=site-e2e-001/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Preparing your project/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/Step \d of 8/)).toBeVisible();

    // Flip the stub — the next 3s poll transitions to the published state.
    phase = 'published';
    await expect(page.getByRole('heading', { name: /Your site is live!/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('e2e-biz.projectsites.dev')).toBeVisible();
    await expect(page.getByRole('button', { name: /View Your Site/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Go to Dashboard/i })).toBeVisible();
  });
});

// ─── Custom website branch ───────────────────────────────────

test.describe('Custom website branch', () => {
  test('custom option opens an empty /create; name is required; filled form builds in custom mode', async ({
    page,
  }) => {
    await blockThirdParty(page);
    await stubApis(page);
    await injectSession(page);

    await page.route('**/api/sites/create-from-search**', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            site_id: 'site-e2e-002',
            slug: 'my-new-project',
            status: 'building',
            workflow_instance_id: 'wf-e2e-002',
          },
        }),
      }),
    );

    await openHomepage(page);
    await searchAndSelect(page, 'my new project', /Build a custom website/);

    // Custom mode → /create with an EMPTY form (clearSelectedBusiness).
    await expect(page).toHaveURL(/\/create/, { timeout: 15_000 });
    const name = page.locator('#create-name');
    await expect(name).toHaveValue('');

    // Required-field value domain: submitting without a name stays on /create
    // and surfaces the error (toast + inline field alert both render the
    // message — .first() avoids the strict-mode double match).
    await page.getByRole('button', { name: /Create site|Create with/ }).click();
    await expect(page.getByText(/Business name is required/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/\/create/);

    // Fill the form. Typing the name opens the create page's own suggestion
    // dropdown (stubbed search) which OVERLAYS the address input — use fill()
    // (keyboard-focus path, no pointer-interception check) instead of click();
    // focusing the address blurs the name and the dropdown closes.
    await name.fill('My New Project');
    await page.locator('#create-address').fill('789 Elm St, Jersey City, NJ');
    await page
      .locator('#create-context')
      .fill('A personal portfolio site showcasing photography and design work.');

    const buildReq = page.waitForRequest(
      (req) => req.url().includes('/api/sites/create-from-search') && req.method() === 'POST',
    );
    await page.getByRole('button', { name: /Create site|Create with/ }).click();
    const posted = (await buildReq).postDataJSON() as { mode: string };
    expect(posted.mode).toBe('custom');

    await expect(page).toHaveURL(/\/waiting\?.*id=site-e2e-002/, { timeout: 15_000 });
  });
});

// ─── Waiting deep-link guard ─────────────────────────────────

test.describe('Waiting deep-link guard', () => {
  test('/waiting without an id redirects to the homepage', async ({ page }) => {
    await blockThirdParty(page);
    await stubApis(page);

    // WaitingComponent.ngOnInit: no `id` query param → router.navigate(['/']).
    await page.goto(`${PROD_URL}/waiting`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('hero-headline')).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/waiting/);
  });
});

// ─── Marketing sections ──────────────────────────────────────

test.describe('Homepage: marketing sections & interactive features', () => {
  test('all sections render; FAQ accordion opens one item at a time; footer present', async ({
    page,
  }) => {
    await blockThirdParty(page);
    await stubApis(page);
    await openHomepage(page);

    // Section inventory (homepage.component.html ids — the old vanilla
    // #proof/#handled/#dvd sections were replaced by #compare/#features).
    for (const id of ['#hero', '#compare', '#how-it-works', '#features', '#pricing', '#faq']) {
      const section = page.locator(id);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
    }

    // FAQ accordion — single-open behavior via the openFaqIndex signal.
    const faq = page.locator('#faq');
    await faq.scrollIntoViewIfNeeded();
    const q1 = faq.getByRole('button', { name: /How long does it take/i });
    await expect(q1).toBeVisible();

    // Open Q1 → exactly one active item.
    await q1.click();
    const active = faq.locator('.faq-active');
    await expect(active).toHaveCount(1);

    // Open Q2 → Q1 closes (still exactly one active).
    const q2 = faq.locator('button').nth(1);
    await q2.click();
    await expect(active).toHaveCount(1);

    // Click Q2 again → accordion fully closes.
    await q2.click();
    await expect(active).toHaveCount(0);

    // Footer.
    const footer = page.locator('footer[role="contentinfo"]');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();

    // Guest nav shows the sign-in affordance.
    await expect(page.getByRole('button', { name: 'Sign In' }).first()).toBeVisible();
  });
});

// ─── Search resilience ───────────────────────────────────────

test.describe('Search resilience', () => {
  test('a failing search API does not crash the page', async ({ page }) => {
    await blockThirdParty(page);
    await stubApis(page);
    // Registered last → matched first: force the search API to 500.
    await page.route('**/api/search/businesses**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fail"}' }),
    );

    await openHomepage(page);
    const input = heroSearch(page);
    await input.click();
    await input.pressSequentially('error test', { delay: 30 });

    // No dropdown results appear, and the shell stays interactive.
    await expect(page.getByRole('button', { name: /error test Pizza/ })).toHaveCount(0);
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('error test');
    await expect(page.getByTestId('hero-headline')).toBeVisible();
  });
});

// ─── API integration (request-level, current contracts) ──────

test.describe('API Integration', () => {
  test('health, search, soft-404 guard, auth gates, and security headers honor current contracts', async ({
    request,
  }) => {
    // ── Health endpoint ──────────────────────────────────
    const healthRes = await request.get('/health');
    expect(healthRes.status()).toBe(200);
    const health = await healthRes.json();
    expect(['ok', 'degraded']).toContain(health.status);
    expect(health).toHaveProperty('version');
    expect(health).toHaveProperty('checks');
    expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);

    // ── Security headers ─────────────────────────────────
    expect(healthRes.headers()['strict-transport-security']).toContain('max-age=');
    expect(healthRes.headers()['x-content-type-options']).toBe('nosniff');
    // Local mock sends DENY; the prod worker sends SAMEORIGIN (observed
    // 2026-07-31). Both deny cross-origin framing.
    expect(['DENY', 'SAMEORIGIN']).toContain(healthRes.headers()['x-frame-options']);
    expect(healthRes.headers()['x-request-id']).toBeTruthy();

    // ── Request ID propagation ───────────────────────────
    const testId = `e2e-${Date.now()}`;
    const idRes = await request.get('/health', { headers: { 'x-request-id': testId } });
    expect(idRes.headers()['x-request-id']).toBe(testId);

    // ── Search API (public GET) ──────────────────────────
    // Shape-only: the local mock always returns 2 rows, but prod proxies
    // LIVE Google Places — result count legitimately varies (can be 0 on
    // quota/no-match), so asserting non-empty was flaky-by-design.
    const searchRes = await request.get('/api/search/businesses?q=pizza');
    expect(searchRes.status()).toBe(200);
    expect(searchRes.headers()['content-type']).toContain('application/json');
    const searchJson = await searchRes.json();
    expect(searchJson.data).toBeInstanceOf(Array);

    // Missing query → 400.
    const noQuery = await request.get('/api/search/businesses');
    expect(noQuery.status()).toBe(400);

    // ── Soft-404 guard: unknown /api/* is machine-readable JSON 404 ──
    // (never the SPA shell — worker commit 76249c96).
    const unknown = await request.get('/api/nonexistent-route-xyz');
    expect(unknown.status()).toBe(404);
    expect(unknown.headers()['content-type']).toContain('application/json');
    const unknownBody = await unknown.json();
    expect(unknownBody.error.code).toBe('NOT_FOUND');

    // ── Auth gates on REAL endpoints ─────────────────────
    for (const route of ['/api/sites', '/api/billing/subscription', '/api/audit-logs']) {
      const res = await request.get(route);
      expect([401, 403], `${route} must be auth-gated`).toContain(res.status());
    }

    // ── Unauthed build POST rejected ─────────────────────
    // 401 from the worker/local mock; 403 when Cloudflare Bot Fight Mode
    // challenges request-context POSTs on prod (verified 2026-07-31 — the
    // challenge fires BEFORE the worker).
    const unauthed = await request.post('/api/sites/create-from-search', {
      data: { mode: 'business', business: { name: 'API Test Biz' } },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(unauthed.status());

    // ── Stripe webhook requires a signature ──────────────
    // 400 (local mock: missing header) / 401 (worker: invalid signature) /
    // 403 (prod BFM challenge on request-context POSTs).
    const stripeRes = await request.post('/webhooks/stripe', {
      data: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401, 403]).toContain(stripeRes.status());
  });
});
