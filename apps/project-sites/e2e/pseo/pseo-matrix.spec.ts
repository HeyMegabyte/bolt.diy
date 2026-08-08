import { test, expect } from '@playwright/test';
import { signInAsTestUser } from '../helpers/auth.js';
import { checkA11y } from '../helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

/**
 * e2e/pseo — pSEO Matrix (flag `pseo_matrix_v2`, FLAG_DOCS evidence spec).
 *
 * SURFACE REALITY (grepped 2026-07-31):
 * - There is NO `/admin/pseo` route and NO `pseo-section` testid anywhere in
 *   frontend/src — app.routes.ts has no `pseo` child; `/admin/pseo` falls through
 *   to the admin `**` wildcard → AdminNotFoundComponent (`admin-not-found`).
 *   The command palette still deep-links `/admin/pseo` (nav-pseo), which lands on
 *   that recovery surface.
 * - The flag's LIVE owner-facing UI is the Features layer card
 *   `sf-card-pseo_matrix_v2` ("Local SEO Pages", requiredPlan business, category
 *   Grow) in site-features.component.ts at `/admin/site-features`:
 *   GET `/api/site-features?site_id=…` → `{features: SiteFeature[], plan}`;
 *   enable/disable POST `/api/site-features/pseo_matrix_v2`
 *   `{site_id, enabled, preview}`; testids sf-root/sf-search/sf-filter-count/
 *   sf-empty / sf-card-{key} / sf-toggle / sf-checklist / sf-locked / sf-undo.
 * - The flag's API is v2: `/api/sites/:id/pseo/v2/{axes,generate,pages,publish}`
 *   (src/routes/pseo_matrix_v2.ts, mounted at /api/sites). `gateOwnedSite` checks
 *   auth FIRST (401), then `isFlagOn('pseo_matrix_v2')` (dark 404, never 403),
 *   then tenancy. Pages row shape: `{id, slug, axis_combo_json, word_count,
 *   unique_data_pct, status, published_at}` + `{stats, page, limit}` — use this
 *   when a matrix admin section ships and this spec grows a grid test.
 *
 * WHY YESTERDAY'S 8 FAILED (inferred from markup/route reality — nothing was run):
 * - All 8 gated on `[data-testid="pseo-section"]` at `/admin/pseo`. That testid
 *   exists NOWHERE in the current tree and the route is unrouted (admin-v2 with
 *   its pSEO section was reverted) → every test timed out on the entry assert
 *   before any row/button logic ran.
 * - Even with a section present they'd still fail: stubs targeted the RETIRED v1
 *   `/api/pseo/:siteId*` shapes (service/city/intent/season rows, approve/publish
 *   per-page buttons) — the live flag serves the v2 axis_combo shape instead.
 * - `mockAuth` stubbed `/api/auth/me` but never injected `localStorage.ps_session`
 *   → the auth guard bounces to /signin before any stub matters.
 * - v1-only assertions (thin-content amber row, per-row approve/publish, status
 *   filter tabs) have NO current surface — dropped, not ported. Ported concepts:
 *   stub-driven render, filter/empty-state, mutation-POST-asserted, empty state.
 */

interface StubSiteFeature {
  key: string;
  name: string;
  description: string;
  requiredPlan: 'free' | 'pro' | 'business';
  isAddon: boolean;
  category: string;
  entitled: 'available' | 'upgrade-required' | 'addon-required';
  enabled: boolean;
  preview: boolean;
}

const PSEO_FEATURE: StubSiteFeature = {
  key: 'pseo_matrix_v2',
  name: 'Local SEO Pages',
  description:
    'Auto-generate location and service landing pages from real data to rank for "near me" searches.',
  requiredPlan: 'business',
  isAddon: false,
  category: 'Grow',
  entitled: 'available',
  enabled: false,
  preview: false,
};

const LOCKED_FEATURE: StubSiteFeature = {
  key: 'site_mcp_server',
  name: 'AI Assistant Access',
  description: 'Make your site queryable by Siri, Claude, and ChatGPT via a per-site MCP server.',
  requiredPlan: 'business',
  isAddon: false,
  category: 'Grow',
  entitled: 'upgrade-required',
  enabled: false,
  preview: false,
};

const INJECTION_QUERY = '<img src=x onerror=window.__pwned=1>';

test.describe('pSEO Matrix v2 — unauth API contract (dark 404 / 401 gates)', () => {
  test('v2 endpoints reject unauthenticated callers, never 2xx or 5xx', async ({ request }) => {
    // gateOwnedSite checks auth BEFORE the flag → unauth is 401 from the worker;
    // 403 is the edge challenge for datacenter traffic. Flag-off with real auth
    // would be the dark 404 (never 403 from the worker) — that leg needs
    // E2E_API_KEY and is covered by the flags evidence suite.
    const pages = await request.get(`${PROD_URL}/api/sites/e2e-nope/pseo/v2/pages`);
    expect([401, 403]).toContain(pages.status());
    if (pages.status() === 401) {
      const body = (await pages.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('UNAUTHORIZED');
    }

    const axes = await request.get(`${PROD_URL}/api/sites/e2e-nope/pseo/v2/axes`);
    expect([401, 403]).toContain(axes.status());

    const generate = await request.post(`${PROD_URL}/api/sites/e2e-nope/pseo/v2/generate`, {
      data: { axes: [] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(generate.status());
    expect(generate.status()).toBeLessThan(500);

    const publish = await request.post(`${PROD_URL}/api/sites/e2e-nope/pseo/v2/publish`, {
      data: { pageIds: [] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(publish.status());
  });
});

test.describe('pSEO Matrix v2 — Features-layer card (stub-authed journey)', () => {
  test('card renders from stub, toggle POST asserted, undo, search value-domains', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // 1) Auth FIRST — helper catch-alls register first so they match LAST.
    await signInAsTestUser(page);

    // 2) Mutation guard — unclaimed mutations never reach real prod.
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    // 3) Section stubs — registered LAST so they match FIRST.
    // glob-ok: query-suffix only — the list GET is /api/site-features?site_id=…;
    // the /:key toggle POST is claimed by the '/**' twin below (mid-token **
    // cannot cross '/').
    await page.route('**/api/site-features**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ features: [PSEO_FEATURE, LOCKED_FEATURE], plan: 'business' }),
      });
    });

    // Glob-law twin: POST /api/site-features/pseo_matrix_v2 lives one segment
    // deeper — the leaf glob above can never match it. This is the surface's
    // real mutation (enable/disable), captured + asserted below.
    const togglePosts: Array<{ site_id?: string; enabled?: boolean }> = [];
    await page.route('**/api/site-features/**', (route) => {
      if (route.request().method() === 'POST') {
        togglePosts.push(
          (route.request().postDataJSON() ?? {}) as { site_id?: string; enabled?: boolean },
        );
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/site-features`, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    // ── Step 1: stub-driven render — card + static capability checklist ──
    await expect(page.getByTestId('sf-root')).toBeVisible({ timeout: 20_000 });
    const card = page.getByTestId('sf-card-pseo_matrix_v2');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('Local SEO Pages')).toBeVisible();
    await expect(card.getByText(/rank for .near me. searches/)).toBeVisible();
    await expect(card.getByTestId('sf-checklist').getByText('Service × city page matrix')).toBeVisible();
    await expect(card.getByTestId('sf-checklist').getByText('Auto-built location landing pages')).toBeVisible();
    // Flag-off calm UI: entitled card renders with the switch OFF — no error, no blank.
    const toggle = card.getByTestId('sf-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.screenshot({ path: 'e2e/screenshots/pseo/01-card-render.png', fullPage: true });

    // ── Step 2: locked sibling shows upgrade path, never a toggle ──
    const locked = page.getByTestId('sf-card-site_mcp_server');
    await expect(locked).toBeVisible();
    await expect(locked.getByTestId('sf-locked')).toBeVisible();
    await expect(locked.getByTestId('sf-toggle')).toHaveCount(0);
    // Scoped to the locked panel: "business plan" ALSO appears in the card's
    // sf-why line ("Locked — included on the business plan and above."), so a
    // card-wide getByText resolves to 2 elements → strict-mode violation.
    await expect(locked.getByTestId('sf-locked')).toContainText(/business plan/);

    // ── Step 3: enable — the mutation POST is intercepted + body-asserted ──
    await toggle.click();
    await expect(page.getByText('Local SEO Pages enabled.').first()).toBeVisible({ timeout: 10_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(togglePosts).toHaveLength(1);
    expect(togglePosts[0]).toMatchObject({ site_id: 'e2e-site-001', enabled: true });
    const undoBar = page.getByTestId('sf-undo');
    await expect(undoBar).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'e2e/screenshots/pseo/02-enabled-undo.png', fullPage: true });

    // ── Step 4: undo reverses via a second asserted POST ──
    await page.getByTestId('sf-undo-btn').click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });
    expect(togglePosts).toHaveLength(2);
    expect(togglePosts[1]).toMatchObject({ site_id: 'e2e-site-001', enabled: false });

    // ── Step 5: search value-domains (the surface's keyword input) ──
    const search = page.getByTestId('sf-search');
    const count = page.getByTestId('sf-filter-count');

    // VALID — matches the pseo card by name.
    await search.fill('local seo');
    await expect(card).toBeVisible();
    await expect(locked).toBeHidden();
    await expect(count).toHaveText(/1\s*of\s*2/);

    // NO-MATCH — calm empty state, never a crash or blank.
    await search.fill('zzz-no-such-feature');
    await expect(page.getByTestId('sf-empty')).toBeVisible({ timeout: 10_000 });

    // INJECTION-SHAPED — treated as an inert query string; nothing executes.
    await search.fill(INJECTION_QUERY);
    await expect(page.getByTestId('sf-empty')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('sf-root').locator('img')).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
    ).toBeUndefined();

    // OVERLONG(400) — UI stays stable, still the calm empty state.
    await search.fill('q'.repeat(400));
    await expect(page.getByTestId('sf-empty')).toBeVisible({ timeout: 10_000 });

    // CLEARED — both cards return. The "N of M" chip is gated
    // `@if (isFiltering())` (shown only while a search is active), so with the
    // query cleared the honest contract is: chip GONE, full catalog back.
    await search.fill('');
    await expect(card).toBeVisible();
    await expect(locked).toBeVisible();
    await expect(count).toHaveCount(0);
    await page.screenshot({ path: 'e2e/screenshots/pseo/03-search-domains.png', fullPage: true });

    await checkA11y(page, 'pseo-features-card');

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'e2e/screenshots/pseo/04-mobile.png', fullPage: true });

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('legacy /admin/pseo URL lands on the calm admin not-found recovery surface', async ({ page }) => {
    // The old spec's entry route. It is UNROUTED today — the admin `**` wildcard
    // renders AdminNotFoundComponent with recovery links. Contract: calm page,
    // zero uncaught errors, a way home. If a real pSEO matrix section ships,
    // this test is the tripwire that says "move the journey to the new route".
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await signInAsTestUser(page);
    await page.goto(`${PROD_URL}/admin/pseo`, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    await expect(page.getByTestId('admin-not-found')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('admin-not-found-home')).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/pseo/05-legacy-route-not-found.png', fullPage: true });

    expect(pageErrors).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/site-features`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first(),
    ).toBeVisible();
  });
});
