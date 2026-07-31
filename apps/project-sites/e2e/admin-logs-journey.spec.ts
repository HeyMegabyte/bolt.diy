import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.use({ serviceWorkers: 'block' });

/**
 * /admin/logs — unified logging dashboard journey (Audit Trail + Log Explorer tabs).
 *
 * Contract: signInAsTestUser FIRST (its `**\/api\/**` catch-all is registered
 * earliest so it matches LAST); the mutation guard + section stubs below are
 * registered AFTER it, so Playwright checks them FIRST. Unstubbed GETs land in
 * the helper catch-all; every POST/PATCH/PUT/DELETE is intercepted.
 *
 * Tab shell: logs-dashboard.component.ts — testids logs-tab-audit /
 * logs-tab-explorer / logs-tab-traces, deep-linked via ?tab=.
 * Audit tab: audit.component.ts — GET /api/audit-logs → { data: AuditRow[] },
 * ag-grid at [data-testid="audit-grid"].
 * Explorer tab: logs-explorer.component.ts — POST /api/logs/search →
 * { data: { items, next_cursor, total_returned } } (append-on-cursor loadMore)
 * + GET /api/logs/cost-by-route → { data: { range, grand_total_cost, rows } }.
 */

/** Realistic AuditRow shapes (mirror audit.component.ts `interface AuditRow`). */
const AUDIT_ROWS = [
  {
    id: 'aud-001',
    action: 'site.created',
    message: 'Site "E2E Test Site" was created',
    target_type: 'site',
    target_id: 'e2e-site-001',
    actor_id: 'e2e-test-user-id',
    metadata: { slug: 'e2e-test-site' },
    request_id: 'req-audit-001',
    created_at: '2026-07-30T12:00:00Z',
    site: 'E2E Test Site',
  },
  {
    id: 'aud-002',
    action: 'auth.magic_link.requested',
    message: 'Magic link requested for test@megabyte.space',
    target_type: 'user',
    target_id: 'e2e-test-user-id',
    actor_id: 'e2e-test-user-id',
    metadata: null,
    request_id: 'req-audit-002',
    created_at: '2026-07-30T11:30:00Z',
    site: null,
  },
  {
    id: 'aud-003',
    action: 'billing.checkout.completed',
    message: 'Checkout completed for plan pro',
    target_type: 'subscription',
    target_id: 'sub-e2e-001',
    actor_id: 'e2e-test-user-id',
    metadata: { plan: 'pro' },
    request_id: 'req-audit-003',
    created_at: '2026-07-30T10:15:00Z',
    site: 'E2E Test Site',
  },
];

/** LogRow shapes (mirror logs-explorer.component.ts `interface LogRow`). */
const LOG_PAGE_1 = [
  {
    id: 'log-001',
    ts: '2026-07-30T12:01:02Z',
    level: 'error',
    request_id: 'req-log-001',
    route: '/api/sites/e2e-site-001/deploy',
    method: 'POST',
    status: 500,
    duration_ms: 2140,
    cost_estimate: 0.000042,
    message: 'Deploy pipeline exploded at upload step',
    meta: null,
  },
  {
    id: 'log-002',
    ts: '2026-07-30T12:00:40Z',
    level: 'info',
    request_id: 'req-log-002',
    route: '/api/sites',
    method: 'GET',
    status: 200,
    duration_ms: 38,
    cost_estimate: 0.000001,
    message: 'Listed 1 site for org e2e-test-org',
    meta: null,
  },
  {
    id: 'log-003',
    ts: '2026-07-30T11:59:12Z',
    level: 'warn',
    request_id: 'req-log-003',
    route: '/api/media/upload',
    method: 'POST',
    status: 200,
    duration_ms: 812,
    cost_estimate: 0.000009,
    message: 'Upload near size cap for asset hero.png',
    meta: null,
  },
];

const LOG_PAGE_2 = [
  {
    id: 'log-004',
    ts: '2026-07-30T11:50:00Z',
    level: 'info',
    request_id: 'req-log-004',
    route: '/api/auth/me',
    method: 'GET',
    status: 200,
    duration_ms: 12,
    cost_estimate: 0.000001,
    message: 'Session verified for e2e-test-user-id',
    meta: null,
  },
  {
    id: 'log-005',
    ts: '2026-07-30T11:45:00Z',
    level: 'debug',
    request_id: 'req-log-005',
    route: '/api/feature-flags',
    method: 'GET',
    status: 200,
    duration_ms: 6,
    cost_estimate: 0.000001,
    message: 'Flag snapshot served from KV',
    meta: null,
  },
];

test.describe('Admin — Logs dashboard (authenticated journey)', () => {
  test('audit + explorer tabs render stubbed rows, filter narrows, pagination appends', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    // 1) Auth FIRST — helper registers its benign catch-alls before our stubs.
    await signInAsTestUser(page);

    // 2) Mutation guard — every POST/PATCH/PUT/DELETE the section stubs below
    // do not claim is intercepted here (never reaches real prod). GETs fall
    // back down to the helper catch-all.
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    // 3) Section stubs — registered LAST so they match FIRST.
    // glob-ok: query-suffix only — /api/audit-logs?limit=… is a leaf endpoint
    await page.route('**/api/audit-logs**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: AUDIT_ROWS }),
      }));

    // POST /api/logs/search — dynamic: `level:error` query narrows to the error
    // row; a `cursor` body means loadMore and returns page 2 (cursor → null).
    await page.route('**/api/logs/search', (route) => {
      const body = (route.request().postDataJSON() ?? {}) as { query?: string; cursor?: string };
      let items = LOG_PAGE_1;
      let nextCursor: string | null = 'cur-page-2';
      if (body.cursor) {
        items = LOG_PAGE_2;
        nextCursor = null;
      } else if ((body.query ?? '').includes('level:error')) {
        items = LOG_PAGE_1.filter((r) => r.level === 'error');
        nextCursor = null;
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { items, next_cursor: nextCursor, total_returned: items.length } }),
      });
    });

    // glob-ok: query-suffix only — cost-by-route is a leaf endpoint
    await page.route('**/api/logs/cost-by-route**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            range: '24h',
            grand_total_cost: 0.000123,
            rows: [
              {
                route: '/api/sites/:id/deploy',
                request_count: 42,
                total_cost: 0.0001,
                avg_duration_ms: 950,
                error_count: 3,
                cost_share_pct: 81.3,
              },
            ],
          },
        }),
      }));

    await page.goto(`${PROD_URL}/admin/logs`, { waitUntil: 'domcontentloaded', timeout: 25_000 });

    expect(page.url()).not.toContain('/signin');
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

    // ── Step 1: tab shell — both named tabs present, Audit Trail selected ──
    const dashboard = page.locator('[data-testid="logs-dashboard"]');
    await expect(dashboard).toBeVisible({ timeout: 15_000 });
    await expect(dashboard.locator('h1')).toHaveText('Logs');

    const auditTab = page.locator('[data-testid="logs-tab-audit"]');
    const explorerTab = page.locator('[data-testid="logs-tab-explorer"]');
    await expect(auditTab).toBeVisible();
    await expect(auditTab).toHaveText(/Audit Trail/);
    await expect(explorerTab).toBeVisible();
    await expect(explorerTab).toHaveText(/Log Explorer/);
    await expect(page.locator('[data-testid="logs-tab-traces"]')).toBeVisible();
    await expect(auditTab).toHaveAttribute('aria-selected', 'true');

    // ── Step 2: Audit Trail tab — ag-grid renders the stubbed rows ──
    await expect(page.locator('[data-testid="audit-grid"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('site.created').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Site "E2E Test Site" was created').first()).toBeVisible();
    await expect(page.getByText('billing.checkout.completed').first()).toBeVisible();
    await page.screenshot({ path: 'e2e/screenshots/admin-logs-journey/01-audit-tab.png', fullPage: true });

    // ── Step 3: switch to Log Explorer via real click (SPA nav, no goto) ──
    await explorerTab.click();
    await expect(explorerTab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
    await expect(page).toHaveURL(/tab=explorer/);

    // ngOnInit auto-search renders all 3 stubbed rows with actual cell text.
    const logRows = page.locator('[data-testid="logs-row"]');
    await expect(page.locator('[data-testid="logs-table"]')).toBeVisible({ timeout: 15_000 });
    await expect(logRows).toHaveCount(3, { timeout: 15_000 });
    await expect(page.getByText('Deploy pipeline exploded at upload step')).toBeVisible();
    await expect(page.getByText('/api/sites/e2e-site-001/deploy')).toBeVisible();
    await expect(page.getByText('Listed 1 site for org e2e-test-org')).toBeVisible();

    // Cost-by-route chart rendered from the cost stub.
    await expect(page.getByText('Route Cost Attribution')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'e2e/screenshots/admin-logs-journey/02-explorer-tab.png', fullPage: true });

    // ── Step 4: pagination — Load more appends page 2 (3 → 5 rows) ──
    const loadMore = page.getByRole('button', { name: 'Load more' });
    await expect(loadMore).toBeVisible({ timeout: 10_000 });
    await loadMore.click();
    await expect(logRows).toHaveCount(5, { timeout: 15_000 });
    await expect(page.getByText('Session verified for e2e-test-user-id')).toBeVisible();
    await expect(loadMore).toBeHidden(); // next_cursor now null
    await page.screenshot({ path: 'e2e/screenshots/admin-logs-journey/03-load-more.png', fullPage: true });

    // ── Step 5: filter input narrows rows (level:error → 1 row) ──
    await page.locator('[data-testid="logs-search-input"]').fill('level:error');
    await page.locator('[data-testid="logs-search-btn"]').click();
    await expect(logRows).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByText('Deploy pipeline exploded at upload step')).toBeVisible();
    await expect(page.getByText('Listed 1 site for org e2e-test-org')).toBeHidden();
    await page.screenshot({ path: 'e2e/screenshots/admin-logs-journey/04-filter-narrowed.png', fullPage: true });

    // ── Step 6: tab back to Audit Trail — grid still renders stubbed rows ──
    await auditTab.click();
    await expect(auditTab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 });
    await expect(page.locator('[data-testid="audit-grid"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('site.created').first()).toBeVisible({ timeout: 15_000 });

    // ag-grid Community's internal aria wiring intermittently reports
    // role="grid" without required children (aria-required-children,
    // critical) during row virtualization — a vendored-widget defect, not our
    // markup. The grid is slated for replacement per
    // docs/perf-wave-ag-grid-to-tanstack.md, which closes this permanently.
    await checkA11y(page, 'admin-logs-journey', { exclude: ['.ag-root'] });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: 'e2e/screenshots/admin-logs-journey/05-mobile.png', fullPage: true });

    const real = errors.filter(
      (e) => !e.includes('favicon') && !e.includes('third-party') && !e.includes('ERR_BLOCKED_BY_CLIENT') && !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/logs`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first()).toBeVisible();
  });
});
