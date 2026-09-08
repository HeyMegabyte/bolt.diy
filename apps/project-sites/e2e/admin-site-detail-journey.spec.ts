/**
 * Admin — Site Detail Journey
 *
 * Covers /admin/sites/e2e-site-001 — the site-detail component.
 * Component reads siteId from ActivatedRoute.
 * All API endpoints are stubbed with realistic non-empty data after auth.
 * Tab type: 'logs' | 'snapshots' | 'sql' | 'integrations' — default: 'logs'
 *
 * STRICT contract (no if-visible guards): tab strip `sd-tab-strip` + tabs
 * `sd-tab-*` + panels (`sd-panel-*` ids / `site-*-panel` testids) are
 * hard-asserted, and each exercised panel must render its STUBBED content
 * (log row 'Build complete', snapshot AI name, exactly the 3 stubbed MCP
 * providers). Screenshots land in e2e/screenshots/site-detail/.
 * No pagination asserts: the SQL tab is an editor + render-capped results
 * (`sql-result-cap`), not a paged browse — sd-page-next/prev has no target.
 */
import { test, expect } from '@playwright/test';
import { signInAsTestUser } from './helpers/auth.js';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

const SITE_OBJ = {
  id: 'e2e-site-001',
  slug: 'e2e-site-001',
  name: 'E2E Test Site',
  status: 'published',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-06-01T00:00:00Z',
  org_id: 'org-e2e-001',
};

test.use({ serviceWorkers: 'block' });

test.describe('Admin — Site Detail (authenticated journey)', () => {
  test('renders site detail shell with name and tab strip', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);

    // GET stubs AFTER auth
    // glob-ok: query-suffix only — /logs/tail is a leaf endpoint
    await page.route('**/api/sites/e2e-site-001/logs/tail**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          logs: [
            { level: 'info', message: 'Build complete', timestamp: '2025-06-01T12:00:00Z' },
            { level: 'info', message: 'Assets uploaded to R2', timestamp: '2025-06-01T12:00:05Z' },
          ],
        }),
      });
    });

    const snapshotsStub = (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'snap-1', ai_name: 'Initial launch version', created_at: '2025-05-01T00:00:00Z', version: 1 },
            { id: 'snap-2', ai_name: 'Header redesign', created_at: '2025-06-01T00:00:00Z', version: 2 },
          ],
        }),
      });
    };
    await page.route('**/api/sites/e2e-site-001/snapshots**', snapshotsStub);
    // Mid-token ** can't cross '/' — twin covers /snapshots/:id/* subpaths
    await page.route('**/api/sites/e2e-site-001/snapshots/**', snapshotsStub);

    const integrationsStub = (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          providers: [
            { key: 'github', name: 'GitHub', connected: false, description: 'Connect to GitHub' },
            { key: 'analytics', name: 'Analytics', connected: true, description: 'Google Analytics 4' },
            { key: 'stripe', name: 'Stripe', connected: false, description: 'Payments' },
          ],
        }),
      });
    };
    // Component fetches GET /sites/:id/integration-providers (NOT /integrations) —
    // the old /integrations glob never matched → component fell back to DEFAULT_PROVIDERS
    // (mailchimp/stripe/hubspot/resend, no github) → the count=3 + github asserts failed. AL-157.
    await page.route('**/api/sites/e2e-site-001/integration-providers**', integrationsStub);
    // Mid-token ** can't cross '/' — twin covers /integration-providers/:id subpaths
    await page.route('**/api/sites/e2e-site-001/integration-providers/**', integrationsStub);

    await page.route('**/api/sites/e2e-site-001**', (route) => {
      // BARE site endpoint ONLY. The trailing ** also matches subpaths
      // (/snapshots, /integration-providers, /logs/tail, …) and this route is registered
      // AFTER their specific stubs, so without this guard it SHADOWS them (Playwright
      // matches last-registered-first) → the component reads res.data/res.providers off
      // `{site:…}` → fake-empty. Delegate any subpath to its own stub. AL-157.
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET' || !pathname.endsWith('/e2e-site-001')) return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: SITE_OBJ }),
      });
    });

    // Intercept ALL mutations
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    expect(page.url()).not.toContain('/signin');

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });

    // Scroll-nudge to trigger appReveal
    await page.mouse.wheel(0, 200);

    // Site detail shell — always renders on this route.
    const detailShell = page.locator('[data-testid="site-detail"]');
    await expect(detailShell).toBeVisible({ timeout: 15_000 });

    // Site name in title. loadSite falls back to a slug-only record derived
    // from the route id, so the regex matches even without the stubbed fetch.
    const title = page.locator('h1.site-detail__title, [data-testid="site-detail"] h1').first();
    await expect(title).toBeVisible({ timeout: 10_000 });
    expect(await title.textContent()).toMatch(/E2E Test Site|e2e-site-001/);

    // Tab strip: container + all four tabs are static template — assert each hard.
    // (id + data-testid now live on the same button; either arm matches it.)
    const tabStrip = page.locator('[data-testid="sd-tab-strip"]');
    await expect(tabStrip).toBeVisible({ timeout: 10_000 });

    const tabLogs = page.locator('[id="sd-tab-logs"], [data-testid="sd-tab-logs"]');
    const tabSnapshots = page.locator('[id="sd-tab-snapshots"], [data-testid="sd-tab-snapshots"]');
    const tabSql = page.locator('[id="sd-tab-sql"], [data-testid="sd-tab-sql"]');
    const tabIntegrations = page.locator('[id="sd-tab-integrations"], [data-testid="sd-tab-integrations"]');

    await expect(tabLogs).toBeVisible({ timeout: 10_000 });
    await expect(tabSnapshots).toBeVisible();
    await expect(tabSql).toBeVisible();
    await expect(tabIntegrations).toBeVisible();

    // Default panel is logs; click through to SQL and back — panels are hard-asserted.
    const logsPanel = page.locator('[data-testid="site-logs-panel"]');
    await expect(logsPanel).toBeVisible({ timeout: 10_000 });

    await tabSql.click();
    await expect(page.locator('[data-testid="site-sql-panel"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="sql-editor"]')).toBeVisible({ timeout: 5_000 });

    await tabLogs.click();
    await expect(logsPanel).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/site-detail/shell.png', fullPage: true });
    await checkA11y(page, 'admin-site-detail-shell');

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('switching tabs updates the active panel (logs → snapshots)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);

    // glob-ok: query-suffix only — /logs/tail is a leaf endpoint
    await page.route('**/api/sites/e2e-site-001/logs/tail**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          logs: [{ level: 'info', message: 'Build complete', timestamp: '2025-06-01T12:00:00Z' }],
        }),
      });
    });

    const snapshotsStub = (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          snapshots: [
            { id: 'snap-1', ai_name: 'Initial launch version', created_at: '2025-05-01T00:00:00Z', version: 1 },
          ],
        }),
      });
    };
    await page.route('**/api/sites/e2e-site-001/snapshots**', snapshotsStub);
    // Mid-token ** can't cross '/' — twin covers /snapshots/:id/* subpaths
    await page.route('**/api/sites/e2e-site-001/snapshots/**', snapshotsStub);

    const integrationsStub = (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: [{ key: 'github', name: 'GitHub', connected: false, description: 'Connect' }] }),
      });
    };
    // Component fetches GET /sites/:id/integration-providers (NOT /integrations) —
    // the old /integrations glob never matched → component fell back to DEFAULT_PROVIDERS
    // (mailchimp/stripe/hubspot/resend, no github) → the count=3 + github asserts failed. AL-157.
    await page.route('**/api/sites/e2e-site-001/integration-providers**', integrationsStub);
    // Mid-token ** can't cross '/' — twin covers /integration-providers/:id subpaths
    await page.route('**/api/sites/e2e-site-001/integration-providers/**', integrationsStub);

    await page.route('**/api/sites/e2e-site-001**', (route) => {
      // BARE site endpoint ONLY. The trailing ** also matches subpaths
      // (/snapshots, /integration-providers, /logs/tail, …) and this route is registered
      // AFTER their specific stubs, so without this guard it SHADOWS them (Playwright
      // matches last-registered-first) → the component reads res.data/res.providers off
      // `{site:…}` → fake-empty. Delegate any subpath to its own stub. AL-157.
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET' || !pathname.endsWith('/e2e-site-001')) return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: SITE_OBJ }),
      });
    });

    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
    await page.mouse.wheel(0, 200);

    // Default panel: logs (the tab signal defaults to 'logs'). The log stream
    // area must render the STUBBED row — proves /logs/tail flowed through.
    const logsPanel = page.locator('[data-testid="site-logs-panel"]');
    await expect(logsPanel).toBeVisible({ timeout: 15_000 });
    const logStream = page.locator('[data-testid="site-logs-tail"]');
    await expect(logStream).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="site-logs-row"]').first()).toContainText('Build complete', {
      timeout: 10_000,
    });

    // Click snapshots tab → snapshots panel replaces logs.
    const tabSnapshots = page.locator('[id="sd-tab-snapshots"], [data-testid="sd-tab-snapshots"]');
    await expect(tabSnapshots).toBeVisible({ timeout: 5_000 });
    await tabSnapshots.click();
    await page.screenshot({ path: 'e2e/screenshots/site-detail/snapshots-tab.png' });

    const snapshotsPanel = page.locator('[data-testid="site-snapshots-panel"]');
    await expect(snapshotsPanel).toBeVisible({ timeout: 5_000 });

    // The stubbed /snapshots response has one row — it must render with the
    // exact stubbed AI name (fallback data would show something else).
    const snapshotRow = page.locator('[data-testid="snapshot-row"]').first();
    await expect(snapshotRow).toBeVisible({ timeout: 5_000 });
    const aiName = page.locator('[data-testid="snapshot-ai-name"]').first();
    await expect(aiName).toBeVisible();
    await expect(aiName).toHaveText('Initial launch version');

    // Switch back to logs — panel state is preserved and the stream re-renders.
    const tabLogs = page.locator('[id="sd-tab-logs"], [data-testid="sd-tab-logs"]');
    await tabLogs.click();
    await expect(page.locator('[data-testid="site-logs-panel"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="site-logs-row"]').first()).toContainText('Build complete', {
      timeout: 10_000,
    });
    await page.screenshot({ path: 'e2e/screenshots/site-detail/back-to-logs.png' });

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('integrations tab loads MCP provider list', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);

    // glob-ok: query-suffix only — /logs/tail is a leaf endpoint
    await page.route('**/api/sites/e2e-site-001/logs/tail**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ logs: [{ level: 'info', message: 'Build OK', timestamp: '2025-06-01T12:00:00Z' }] }),
      });
    });

    const snapshotsStub = (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ snapshots: [] }),
      });
    };
    await page.route('**/api/sites/e2e-site-001/snapshots**', snapshotsStub);
    // Mid-token ** can't cross '/' — twin covers /snapshots/:id/* subpaths
    await page.route('**/api/sites/e2e-site-001/snapshots/**', snapshotsStub);

    const integrationsStub = (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          providers: [
            { key: 'github', name: 'GitHub', connected: false, description: 'Connect to GitHub for auto-deploy' },
            { key: 'analytics', name: 'Analytics', connected: true, description: 'Google Analytics 4 wired' },
            { key: 'stripe', name: 'Stripe', connected: false, description: 'Accept payments' },
          ],
        }),
      });
    };
    // Component fetches GET /sites/:id/integration-providers (NOT /integrations) —
    // the old /integrations glob never matched → component fell back to DEFAULT_PROVIDERS
    // (mailchimp/stripe/hubspot/resend, no github) → the count=3 + github asserts failed. AL-157.
    await page.route('**/api/sites/e2e-site-001/integration-providers**', integrationsStub);
    // Mid-token ** can't cross '/' — twin covers /integration-providers/:id subpaths
    await page.route('**/api/sites/e2e-site-001/integration-providers/**', integrationsStub);

    await page.route('**/api/sites/e2e-site-001**', (route) => {
      // BARE site endpoint ONLY. The trailing ** also matches subpaths
      // (/snapshots, /integration-providers, /logs/tail, …) and this route is registered
      // AFTER their specific stubs, so without this guard it SHADOWS them (Playwright
      // matches last-registered-first) → the component reads res.data/res.providers off
      // `{site:…}` → fake-empty. Delegate any subpath to its own stub. AL-157.
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET' || !pathname.endsWith('/e2e-site-001')) return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: SITE_OBJ }),
      });
    });

    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
    await page.mouse.wheel(0, 200);

    const tabIntegrations = page.locator('[id="sd-tab-integrations"], [data-testid="sd-tab-integrations"]');
    await expect(tabIntegrations).toBeVisible({ timeout: 10_000 });
    await tabIntegrations.click();
    await page.screenshot({ path: 'e2e/screenshots/site-detail/integrations-tab.png' });

    const intPanel = page.locator('[data-testid="site-integrations-panel"]');
    await expect(intPanel).toBeVisible({ timeout: 5_000 });

    // The STUBBED provider list must render — exactly the 3 stubbed providers
    // (loadIntegrations replaces, never merges; DEFAULT_PROVIDERS has no
    // github key, so these asserts fail if the stub didn't flow through).
    const providerList = page.locator('[data-testid="mcp-provider-list"]');
    await expect(providerList).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid^="mcp-provider-card-"]')).toHaveCount(3, { timeout: 5_000 });
    const githubCard = page.locator('[data-testid="mcp-provider-card-github"]');
    await expect(githubCard).toBeVisible({ timeout: 5_000 });
    await expect(githubCard).toContainText('GitHub');

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('deep-link ?tab=sql renders SQL panel directly', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await signInAsTestUser(page);

    // glob-ok: query-suffix only — /logs/tail is a leaf endpoint
    await page.route('**/api/sites/e2e-site-001/logs/tail**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ logs: [] }),
      });
    });
    const snapshotsStub = (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ snapshots: [] }) });
    };
    await page.route('**/api/sites/e2e-site-001/snapshots**', snapshotsStub);
    // Mid-token ** can't cross '/' — twin covers /snapshots/:id/* subpaths
    await page.route('**/api/sites/e2e-site-001/snapshots/**', snapshotsStub);
    const integrationsStub = (route: import('@playwright/test').Route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) });
    };
    // Component fetches GET /sites/:id/integration-providers (NOT /integrations) —
    // the old /integrations glob never matched → component fell back to DEFAULT_PROVIDERS
    // (mailchimp/stripe/hubspot/resend, no github) → the count=3 + github asserts failed. AL-157.
    await page.route('**/api/sites/e2e-site-001/integration-providers**', integrationsStub);
    // Mid-token ** can't cross '/' — twin covers /integration-providers/:id subpaths
    await page.route('**/api/sites/e2e-site-001/integration-providers/**', integrationsStub);
    await page.route('**/api/sites/e2e-site-001**', (route) => {
      // BARE site endpoint ONLY. The trailing ** also matches subpaths
      // (/snapshots, /integration-providers, /logs/tail, …) and this route is registered
      // AFTER their specific stubs, so without this guard it SHADOWS them (Playwright
      // matches last-registered-first) → the component reads res.data/res.providers off
      // `{site:…}` → fake-empty. Delegate any subpath to its own stub. AL-157.
      const pathname = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET' || !pathname.endsWith('/e2e-site-001')) return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: SITE_OBJ }),
      });
    });
    await page.route('**/api/**', async (route) => {
      const m = route.request().method();
      if (m === 'POST' || m === 'PATCH' || m === 'PUT' || m === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001?tab=sql`, { waitUntil: 'domcontentloaded', timeout: 25_000 });
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 35_000 });
    await page.mouse.wheel(0, 200);

    // ?tab=sql is applied via queryParamMap → the SQL panel renders directly.
    const sqlPanel = page.locator('[data-testid="site-sql-panel"]');
    await expect(sqlPanel).toBeVisible({ timeout: 15_000 });

    // Editor + read-only affordances are static template inside the SQL panel.
    const sqlEditor = page.locator('[data-testid="sql-editor"]');
    await expect(sqlEditor).toBeVisible({ timeout: 5_000 });
    const readonlyPill = page.locator('[data-testid="sql-readonly-pill"], [data-testid="sql-safe-note"]').first();
    await expect(readonlyPill).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/site-detail/sql-deeplink.png' });

    const real = errors.filter(
      (e) =>
        !e.includes('favicon') &&
        !e.includes('third-party') &&
        !e.includes('ERR_BLOCKED_BY_CLIENT') &&
        !e.toLowerCase().includes('failed to load resource'),
    );
    expect(real).toEqual([]);
  });

  test('unauthenticated access redirects to sign-in', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/sites/e2e-site-001`);
    await page.waitForURL('**/signin**', { timeout: 10_000 });
    await expect(
      page.locator('[data-testid="sign-in-page"], [data-testid="auth-container"], form').first(),
    ).toBeVisible();
  });
});
