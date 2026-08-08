/**
 * PROMOTION EVIDENCE — flag `site_analytics` (DARK: enabled=0, experimental).
 *
 * REAL GATING MECHANISM (grepped 2026-07-31):
 * - The gate is SERVER-SIDE ONLY. `libs/features/site_analytics/handlers.ts`
 *   wraps every route in `requireOrgFlag(c, 'site_analytics')` → 401 anon /
 *   404 flag-off (never 403 — `src/lib/feature_guard.ts`). Mounted at
 *   `src/index.ts:1095` (`app.route('/', siteAnalytics)`) BEFORE
 *   `app.route('/', api)` (:1191), so it OWNS `GET /api/sites/:siteId/analytics`
 *   and SHADOWS the legacy CF multi-URL envelope handler in `src/routes/api.ts`
 *   (~:10893) that the admin section was written against.
 * - The ADMIN section (`sections/analytics.component.ts`, `app-admin-analytics`)
 *   reads NO flag client-side. It discovers the gate from the HTTP status:
 *   404 → `notAvailable` → calm cyan `data-testid="analytics-unavailable"`
 *   notice + auto-refresh paused; any other failure → red error card
 *   (`data-testid="analytics-error"`, added with this evidence spec).
 * - ⚠️ Shape note for promotion: flag-ON, the module returns the OWNER summary
 *   `{contacts, formSubmissions, subscribers, donations, traffic:{pageviews,
 *   uniqueSessions, conversions}}` — NOT what the admin section parses. The
 *   component consumes `MultiUrlAnalyticsEnvelope` (api.service.ts:1467):
 *   `{data:{range_days, urls_included:[{hostname,resolved_zone}], pageviews,
 *   uniques, total_requests, series:[{date,page_views,unique_visitors,
 *   requests}], top_pages, top_countries, top_referrers, any_real_data}}`.
 *   Promotion must reconcile the shapes; stub-on mode below stubs THAT exact
 *   envelope — a wrong-shaped 200 is worse than a 404 here, because
 *   `isResolved()` dereferences `envelope.urls_included.find(…)` unguarded:
 *   with URL pills present the render pass throws mid-template and the KPI
 *   tiles freeze as empty skeletons. (admin-analytics-journey.spec.ts stubs a
 *   legacy shape and stays green only because its asserts are visible-only —
 *   this spec is the render PROOF, so the stub must be shape-true.)
 *
 * FLAG_DOCS checklist coverage (`src/modules/feature_flags/docs.ts`):
 * - "When off, /api/sites/:id/analytics returns 404" → tests 1 + 2.
 * - Owner-facing summary surface render proof (stubbed) → test 3.
 *
 * TDD contract: authedPage fixture; section stubs registered in the test body
 * (AFTER the helper → matched FIRST, reverse-registration order); ALL mutations
 * intercepted; glob-law '/**' twins; hard asserts; zero-console-error with
 * favicon/'failed to load resource' filters; screenshots; NO networkidle;
 * bounded action timeouts.
 */

import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'https://projectsites.dev';
const SITE_ID = 'e2e-site-001'; // the single site seeded by helpers/auth.ts _stubAdminApis
const PROBE_SITE = 'e2e-flag-evidence-probe'; // synthetic — never owned, never real

const MUTATIONS = ['POST', 'PATCH', 'PUT', 'DELETE'];

const NOT_FOUND_BODY = JSON.stringify({
  error: { code: 'NOT_FOUND', message: 'Not found', request_id: 'e2e-stub' },
});

/**
 * The EXACT `MultiUrlAnalyticsEnvelope` the component consumes
 * (api.service.ts:1467). Field names matter: the KPI tiles bind
 * `pageviews` / `uniques` / `total_requests`, the sparklines map
 * `series[].page_views` / `unique_visitors`, and `isResolved()` reads
 * `urls_included.find(…)` UNGUARDED — the hostname must match the /urls stub
 * so the URL pill resolves without throwing mid-render.
 */
const ANALYTICS_ENVELOPE = JSON.stringify({
  data: {
    range_days: 7,
    urls_included: [{ hostname: 'e2e-test-site.projectsites.dev', resolved_zone: true }],
    pageviews: 12_450,
    uniques: 3_210,
    total_requests: 28_900,
    series: [
      { date: '2026-07-29', page_views: 6_200, unique_visitors: 1_600, requests: 14_400 },
      { date: '2026-07-30', page_views: 6_250, unique_visitors: 1_610, requests: 14_500 },
    ],
    top_pages: [
      { path: '/', views: 8_400 },
      { path: '/about', views: 2_150 },
    ],
    top_countries: [{ country: 'US', views: 9_900 }],
    top_referrers: [{ referrer: 'https://google.com/', views: 4_300 }],
    any_real_data: true,
  },
});

/** Console-error collector with the mandated favicon/'failed to load resource' filters. */
function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function realErrors(errors: string[]): string[] {
  return errors.filter((e) => {
    const low = e.toLowerCase();
    return (
      !low.includes('favicon') &&
      !low.includes('failed to load resource') &&
      !low.includes('posthog') &&
      !low.includes('sentry') &&
      !low.includes('google') &&
      !low.includes('net::err_blocked_by_client') &&
      !low.includes('third-party')
    );
  });
}

/** Flag-OFF mode: every analytics route (all methods, incl. mutations) → 404 envelope. */
async function stubAnalyticsFlagOff(page: Page): Promise<void> {
  const flagOff = async (route: Route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: NOT_FOUND_BODY });
  };
  // Query-suffix pattern + glob-law '/**' twin (mid-token ** cannot cross '/'):
  // the twin covers /analytics/daily|sections|forms|funnel|export|share.
  await page.route(`**/api/sites/${SITE_ID}/analytics**`, flagOff);
  await page.route(`**/api/sites/${SITE_ID}/analytics/**`, flagOff);
}

/** Stub-ON mode: GET → realistic envelope; ALL mutations intercepted with a benign stub. */
async function stubAnalyticsOn(page: Page): Promise<void> {
  const serve = async (route: Route) => {
    if (MUTATIONS.includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: ANALYTICS_ENVELOPE });
  };
  await page.route(`**/api/sites/${SITE_ID}/analytics**`, serve);
  await page.route(`**/api/sites/${SITE_ID}/analytics/**`, serve);
  // The KPI envelope now comes from getMultiUrlAnalytics → GET
  // `/api/sites/:id/multi-url-analytics` (api.service.ts:807 — a DISTINCT path from
  // `/analytics` so the summary handler can't shadow it). The old stub only covered
  // `/analytics**`, so the envelope call hit the real endpoint → {data:null} →
  // skeleton → empty KPIs. Stub the multi-url path too so the KPIs populate. (07tt)
  await page.route(`**/api/sites/${SITE_ID}/multi-url-analytics**`, serve);

  // Site URL list — one bound hostname so the multi-URL fan-out has a selection.
  const urls = async (route: Route) => {
    if (MUTATIONS.includes(route.request().method())) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{ id: 'url-1', hostname: 'e2e-test-site.projectsites.dev', is_primary: 1 }],
      }),
    });
  };
  await page.route(`**/api/sites/${SITE_ID}/urls**`, urls);
  await page.route(`**/api/sites/${SITE_ID}/urls/**`, urls);

  // CF credentials configured+valid → the "Connect Cloudflare" banner stays
  // hidden. Shape-true `CloudflareCredentialStatus` (api.service.ts:1500) —
  // the component branches on `source === 'none'`, so the real field set is
  // what keeps the connect-CTA suppressed.
  const creds = async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          has_credentials: true,
          source: 'org',
          email: 'test@megabyte.space',
          last_validated_at: '2026-07-30T00:00:00Z',
          last_validated_account_id: 'acct-e2e',
        },
      }),
    });
  };
  await page.route('**/api/admin/cloudflare-credentials**', creds);
  await page.route('**/api/admin/cloudflare-credentials/**', creds);
}

test.describe('FLAG EVIDENCE — site_analytics', () => {
  test('flag-off server contract: gated route answers JSON 404/401 — never 403, never 200/HTML', async ({
    authedPage: page,
  }) => {
    // Let the probe path pass THROUGH to real prod (registered after the helper
    // → matched first; continue() is terminal). Browser-context fetch keeps the
    // real Chrome UA + app origin, so no WAF/BFM artifacts.
    await page.route(`**/api/sites/${PROBE_SITE}/analytics**`, (r) => r.continue());
    await page.route(`**/api/sites/${PROBE_SITE}/analytics/**`, (r) => r.continue());

    const bearer = process.env.E2E_API_KEY ?? 'e2e-stub-session-token';
    const authedReal = Boolean(process.env.E2E_API_KEY);

    const res = await page.evaluate(
      async ({ path, token }: { path: string; token: string }) => {
        const r = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
        return {
          status: r.status,
          contentType: r.headers.get('content-type') ?? '',
          text: await r.text(),
        };
      },
      { path: `/api/sites/${PROBE_SITE}/analytics`, token: bearer },
    );

    // The never-leak contract: 404 when authed + flag off (or not owned),
    // 401 when the bearer is not a real session. NEVER 403, NEVER a 200 page.
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(200);
    expect([401, 404]).toContain(res.status);
    expect(res.contentType).toContain('application/json');

    const body = JSON.parse(res.text) as { error?: { code?: string; message?: string } };
    expect(['NOT_FOUND', 'UNAUTHORIZED']).toContain(body.error?.code ?? '');

    if (authedReal) {
      // Real E2E_API_KEY session → the flag gate itself: exact 404 NOT_FOUND.
      expect(res.status).toBe(404);
      expect(body.error?.code).toBe('NOT_FOUND');
    }
  });

  test('flag-off/no-data: 404 renders the calm empty state + Network Overview — never the red error card', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubAnalyticsFlagOff(page);

    await page.goto(`${BASE}/admin/analytics`, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    // The site_analytics 404 (flag-off / no per-site data) is handled by the REDESIGNED
    // analytics surface (07j-k; root-traced locally 07tt): the 404 falls back to the
    // Network Overview (platform-wide) + calm per-tab empty states ("No traffic yet"),
    // NOT the old `analytics-unavailable` notice — that `@else if (notAvailable())` branch
    // is no longer reached (`notAvailable()` stays false; a 404 → empty-fallback, and
    // site_analytics is globally enabled since 2026-08-04 so flag-off is a dead path). The
    // CONTRACT this test guards is UNCHANGED: a 404 renders a CALM state, NEVER the red
    // error card. Section heading + a "no traffic/data" empty indicator prove it loaded
    // calmly; analytics-error absent proves no alarm. (Old stale asserts:
    // `analytics-unavailable` visible + `kpi-pageviews` count 0 — both wrong post-redesign.)
    await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator('[data-testid="analytics-error"]')).toHaveCount(0);
    await expect(page.getByText(/no (platform )?traffic|no data yet/i).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.screenshot({
      path: 'e2e/screenshots/admin-analytics-flag/01-flag-off-calm.png',
      fullPage: false,
    });

    expect(realErrors(errors)).toEqual([]);
  });

  test('stub-on render proof: KPI cards populate from the analytics envelope', async ({
    authedPage: page,
  }) => {
    const errors = collectConsoleErrors(page);
    await stubAnalyticsOn(page);

    await page.goto(`${BASE}/admin/analytics`, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    // All three KPI cards render, HARD — this is the enabled-surface proof.
    await expect(page.locator('[data-testid="kpi-pageviews"]')).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('[data-testid="kpi-visitors"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="kpi-requests"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="kpi-pageviews"]')).not.toHaveText('');

    // The flag-off states must NOT render alongside the data.
    await expect(page.locator('[data-testid="analytics-unavailable"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="analytics-error"]')).toHaveCount(0);

    await page.screenshot({
      path: 'e2e/screenshots/admin-analytics-flag/02-stub-on-kpis.png',
      fullPage: false,
    });

    expect(realErrors(errors)).toEqual([]);
  });
});
