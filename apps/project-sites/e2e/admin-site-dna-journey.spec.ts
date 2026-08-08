/**
 * Admin — Site DNA Journey (STRICT — zero soft-guards)
 *
 * Covers /admin/sites/:id/dna — the Site DNA Taste Graph admin panel,
 * flag-gated by `site_dna_taste_graph`. The component reads siteId from the
 * ROUTE (:id on the flat `sites/:id/dna` route), so we navigate directly to
 * /admin/sites/e2e-site-001/dna — the ONE site the auth helper stubs into
 * the sites list.
 *
 * Flag reality (greped from site-dna.component.ts): unlike the copilot
 * sibling, this surface IS client-side flag-gated — ngOnInit calls
 * FeatureFlagService.isOn('site_dna_taste_graph'), which GETs
 * /api/feature-flags/site_dna_taste_graph and expects
 * `{ resolved: { enabled } }`. Flag off → the calm
 * <app-flag-gate-notice testid="dna-flag-gate"> renders and the org-scoped
 * /api/site-dna fetches NEVER fire (asserted). Flag on → forkJoin of
 * history + preferences populates stats, taste pulse, prefs chart and table.
 *
 * Contract:
 * - signInAsTestUser(page) FIRST; section stubs register AFTER it so they win
 *   reverse-match order over the auth helper's `/api/feature-flags`
 *   continue() pass-throughs and its benign `**` catch-all.
 * - ALL mutations intercepted; the manual-feedback POST is captured and its
 *   body asserted. The invalid-context-JSON client boundary is asserted to
 *   block the POST entirely.
 * - Glob law: mid-token `**` cannot cross '/', so /api/site-dna gets its
 *   `/**` subpath twin (history / preferences / feedback all live under it).
 * - No new testids needed: dna-flag-gate, dna-stats, dna-taste-pulse,
 *   dna-prefs-chart, dna-table-scroll, dna-feedback-form and the three form
 *   testids already exist in the template.
 */
import { test, expect, type Page } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

interface CapturedPost {
  url: string;
  body: Record<string, unknown> | null;
}

/**
 * Deterministic history rows. Shape mirrors the worker's
 * GET /api/site-dna/:id/history response: `{ site_id, history, count }`.
 * 3 accept + 1 reject + 1 edit → stats 5/3/1/1 and a 60% accept ratio, so
 * every stat counter, the taste-pulse segments, and all three action-chip
 * variants render.
 */
const HISTORY_PAYLOAD = {
  site_id: 'e2e-site-001',
  history: [
    {
      id: 'fb-001',
      component_id: 'hero-section-v2',
      component_class: 'hero',
      action: 'accept',
      context: null,
      created_at: '2026-07-30T22:00:00Z',
    },
    {
      id: 'fb-002',
      component_id: 'trust-strip-v1',
      component_class: 'trust-strip',
      action: 'accept',
      context: null,
      created_at: '2026-07-30T21:00:00Z',
    },
    {
      id: 'fb-003',
      component_id: 'faq-accordion-v3',
      component_class: 'faq',
      action: 'accept',
      context: null,
      created_at: '2026-07-30T20:00:00Z',
    },
    {
      id: 'fb-004',
      component_id: 'pricing-table-v1',
      component_class: 'pricing-table',
      action: 'reject',
      context: { reason: 'too dense' },
      created_at: '2026-07-30T19:00:00Z',
    },
    {
      id: 'fb-005',
      component_id: 'footer-v2',
      component_class: 'footer',
      action: 'edit',
      context: null,
      created_at: '2026-07-30T18:00:00Z',
    },
  ],
  count: 5,
};

/**
 * Deterministic preference rows. Shape mirrors
 * GET /api/site-dna/:id/preferences: `{ site_id, component_class,
 * preferences, count }`. One positive + one negative net score exercises both
 * bar colors and the +/- score rendering.
 */
const PREFS_PAYLOAD = {
  site_id: 'e2e-site-001',
  component_class: '',
  preferences: [
    { component_class: 'hero', accept_count: 5, reject_count: 1, net_score: 4 },
    { component_class: 'pricing-table', accept_count: 1, reject_count: 3, net_score: -2 },
  ],
  count: 2,
};

/**
 * Registers the section's deterministic stubs. MUST run AFTER
 * signInAsTestUser(page) — Playwright matches routes in reverse registration
 * order, so these override the auth helper's /api/feature-flags continue()
 * routes and its benign catch-all.
 * Returns capture arrays for feedback POSTs and ALL /api/site-dna requests
 * (the latter proves the flag-off path never fetches).
 */
async function installDnaStubs(
  page: Page,
  opts: { flagOn: boolean },
): Promise<{ posts: CapturedPost[]; dnaRequests: string[] }> {
  const posts: CapturedPost[] = [];
  const dnaRequests: string[] = [];

  // ALL mutations intercepted with a benign 200; GETs fall through to the
  // more-specific handlers below or to the auth helper's routes.
  // glob-ok: deliberate catch-all, mutation-only fulfill.
  await page.route('**/api/**', (route) => {
    const m = route.request().method();
    if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return route.fallback();
  });

  // Flag override — force `site_dna_taste_graph` to the test's state. The
  // component consumes the per-key resolution endpoint; query-suffix glob +
  // '/**' twin per glob law (mid-token ** cannot cross '/'). Every other flag
  // key falls through to the auth helper's continue() → real prod state.
  const flagResolution = JSON.stringify({
    resolved: {
      enabled: opts.flagOn,
      rollout_percent: opts.flagOn ? 100 : 0,
      stage: opts.flagOn ? 'stable' : 'experimental',
      source: 'override',
    },
  });
  const flagHandler = (route: import('@playwright/test').Route) => {
    const url = route.request().url();
    if (
      route.request().method() === 'GET' &&
      url.includes('/api/feature-flags/site_dna_taste_graph')
    ) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: flagResolution });
    }
    return route.fallback();
  };
  await page.route('**/api/feature-flags**', flagHandler);
  await page.route('**/api/feature-flags/**', flagHandler);

  // Site-DNA endpoints — history / preferences / feedback all live on
  // subpaths of /api/site-dna, so the '/**' twin is the load-bearing glob;
  // the query-suffix base glob is registered for completeness.
  const dnaHandler = (route: import('@playwright/test').Route) => {
    const req = route.request();
    const url = req.url();
    dnaRequests.push(`${req.method()} ${url}`);

    if (req.method() === 'GET' && url.includes('/history')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(HISTORY_PAYLOAD),
      });
    }
    if (req.method() === 'GET' && url.includes('/preferences')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PREFS_PAYLOAD),
      });
    }
    if (req.method() === 'POST' && url.includes('/feedback')) {
      posts.push({ url, body: req.postDataJSON() as Record<string, unknown> | null });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"id":"fb-new-001"}',
      });
    }
    return route.fallback();
  };
  await page.route('**/api/site-dna**', dnaHandler);
  await page.route('**/api/site-dna/**', dnaHandler);

  return { posts, dnaRequests };
}

/** Attach a console-error collector BEFORE navigation. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Filter out third-party/network noise that isn't an app defect. */
function realErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('favicon') &&
      !e.includes('third-party') &&
      !e.includes('ERR_BLOCKED_BY_CLIENT') &&
      !e.toLowerCase().includes('failed to load resource'),
  );
}

/** Navigate to the dna child route and wait for the section to mount. */
async function openDna(page: Page): Promise<void> {
  await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/dna`, {
    waitUntil: 'domcontentloaded',
    timeout: 25_000,
  });
  expect(page.url()).not.toContain('/signin');
  await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
  // Scroll-nudge triggers appReveal (opacity: 0 on mount).
  await page.mouse.wheel(0, 200);
  await expect(
    page.locator('app-admin-site-dna').getByRole('heading', { name: 'Taste Graph' }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('Admin — Site DNA (authenticated journey)', () => {
  test('flag OFF — calm gate notice renders, shell intact, zero site-dna fetches', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    const { dnaRequests } = await installDnaStubs(page, { flagOn: false });
    await openDna(page);

    const root = page.locator('app-admin-site-dna');

    // The calm flag-gate notice is the rendered OFF path — never a crash,
    // never a blank shell.
    const gate = page.locator('[data-testid="dna-flag-gate"]');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText('Platform flag');
    await expect(gate).toContainText('The Site DNA Taste Graph');

    // The gated body never mounts while off: no stats, no table, no form.
    await expect(page.locator('[data-testid="dna-stats"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dna-table-scroll"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="dna-feedback-form"]')).toHaveCount(0);

    // Header (with the flag-key chip) stays mounted around the notice.
    await expect(root.getByRole('heading', { name: 'Taste Graph' })).toBeVisible();
    await expect(root.locator('code.dna-flag-chip')).toHaveText('site_dna_taste_graph');

    // The component short-circuits BEFORE any org-scoped fetch: not one
    // request reached /api/site-dna/*.
    expect(dnaRequests).toEqual([]);

    await page.screenshot({ path: 'e2e/screenshots/site-dna/flag-off.png', fullPage: true });
    await checkA11y(page, 'site-dna-flag-off');

    expect(realErrors(errors)).toEqual([]);
  });

  test('flag ON — stats, taste pulse, prefs chart and history render from stubs; feedback POST is captured', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await signInAsTestUser(page);
    const { posts } = await installDnaStubs(page, { flagOn: true });
    await openDna(page);

    // Gate notice absent — the real surface mounted.
    await expect(page.locator('[data-testid="dna-flag-gate"]')).toHaveCount(0);

    // Stats settle on the stubbed totals (rolling counters finish <1s).
    const stats = page.locator('[data-testid="dna-stats"]');
    await expect(stats).toBeVisible({ timeout: 15_000 });
    await expect(stats).toContainText('5 signals', { timeout: 15_000 });
    await expect(stats).toContainText('3 accepted');
    await expect(stats).toContainText('1 rejected');
    await expect(stats).toContainText('1 edited');
    await expect(stats).toContainText('2 classes');

    // Taste pulse — 3 of 5 accepted → 60% accept rate.
    const pulse = page.locator('[data-testid="dna-taste-pulse"]');
    await expect(pulse).toBeVisible();
    await expect(pulse).toContainText('60% accept rate');

    // Preferences chart — positive and negative net scores both render.
    const prefsChart = page.locator('[data-testid="dna-prefs-chart"]');
    await expect(prefsChart).toBeVisible();
    await expect(prefsChart).toContainText('hero');
    await expect(prefsChart).toContainText('+4');
    await expect(prefsChart).toContainText('pricing-table');
    await expect(prefsChart).toContainText('-2');

    // History table — exactly the 5 stubbed rows, all three action chips.
    const table = page.locator('[data-testid="dna-table-scroll"]');
    await expect(table.locator('tbody tr')).toHaveCount(5, { timeout: 15_000 });
    await expect(page.locator('[data-testid="dna-load-error"]')).toHaveCount(0);
    await expect(table.locator('.dna-action-chip.accept')).toHaveCount(3);
    await expect(table.locator('.dna-action-chip.reject')).toHaveCount(1);
    await expect(table.locator('.dna-action-chip.edit')).toHaveCount(1);
    await expect(table).toContainText('hero-section-v2');

    await page.screenshot({ path: 'e2e/screenshots/site-dna/flag-on.png', fullPage: true });
    await checkA11y(page, 'site-dna-flag-on');

    // ── Interaction: manual feedback form. ──
    const form = page.locator('[data-testid="dna-feedback-form"]');
    await expect(form).toBeVisible();
    const cid = page.locator('[data-testid="dna-component-id-input"]');
    const submit = page.locator('[data-testid="dna-submit-btn"]');

    // Client boundary: invalid context JSON blocks the POST with an inline
    // role=alert error — nothing reaches the wire.
    await cid.fill('hero-section-v2');
    await page.locator('[data-testid="dna-context-input"]').fill('not-json');
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(form.getByRole('alert')).toContainText('Context must be valid JSON');
    expect(posts).toHaveLength(0);

    // Fix the boundary violation and submit for real — POST captured +
    // success status + input cleared by the component.
    await page.locator('[data-testid="dna-context-input"]').fill('');
    await submit.click();
    await expect(form.getByRole('status')).toContainText('Feedback recorded', { timeout: 15_000 });
    await expect(cid).toHaveValue('');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain('/api/site-dna/e2e-site-001/feedback');
    expect(posts[0].body).toMatchObject({ component_id: 'hero-section-v2', action: 'accept' });

    await page.screenshot({ path: 'e2e/screenshots/site-dna/feedback-submitted.png' });

    expect(realErrors(errors)).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001/dna`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first(),
    ).toBeVisible();
  });
});
