/**
 * Admin — Site Detail Journey
 *
 * Covers /admin/sites/e2e-site-001 — the site-detail component.
 * Component reads siteId from ActivatedRoute.
 * All API endpoints are stubbed with realistic non-empty data after auth.
 * Tab type: 'logs' | 'snapshots' | 'sql' | 'integrations' — default: 'logs'
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

    await page.route('**/api/sites/e2e-site-001/snapshots**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          snapshots: [
            { id: 'snap-1', ai_name: 'Initial launch version', created_at: '2025-05-01T00:00:00Z', version: 1 },
            { id: 'snap-2', ai_name: 'Header redesign', created_at: '2025-06-01T00:00:00Z', version: 2 },
          ],
        }),
      });
    });

    await page.route('**/api/sites/e2e-site-001/integrations**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          providers: [
            { key: 'github', name: 'GitHub', connected: false, description: 'Connect to GitHub' },
            { key: 'analytics', name: 'Analytics', connected: true, description: 'Google Analytics 4' },
          ],
        }),
      });
    });

    await page.route('**/api/sites/e2e-site-001**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ site: SITE_OBJ }),
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

    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });

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

    // Tab strip: all four tabs are static template — assert each one hard.
    // (id + data-testid now live on the same button; either arm matches it.)
    const tabLogs = page.locator('[id="sd-tab-logs"], [data-testid="sd-tab-logs"]');
    const tabSnapshots = page.locator('[id="sd-tab-snapshots"], [data-testid="sd-tab-snapshots"]');
    const tabSql = page.locator('[id="sd-tab-sql"], [data-testid="sd-tab-sql"]');
    const tabIntegrations = page.locator('[id="sd-tab-integrations"], [data-testid="sd-tab-integrations"]');

    await expect(tabLogs).toBeVisible({ timeout: 10_000 });
    await expect(tabSnapshots).toBeVisible();
    await expect(tabSql).toBeVisible();
    await expect(tabIntegrations).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-site-detail/shell.png', fullPage: true });
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

    await page.route('**/api/sites/e2e-site-001/snapshots**', (route) => {
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
    });

    await page.route('**/api/sites/e2e-site-001/integrations**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ providers: [{ key: 'github', name: 'GitHub', connected: false, description: 'Connect' }] }),
      });
    });

    await page.route('**/api/sites/e2e-site-001**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ site: SITE_OBJ }),
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
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // Default panel: logs (the tab signal defaults to 'logs').
    const logsPanel = page.locator('[data-testid="site-logs-panel"]');
    await expect(logsPanel).toBeVisible({ timeout: 15_000 });

    // Click snapshots tab → snapshots panel replaces logs.
    const tabSnapshots = page.locator('[id="sd-tab-snapshots"], [data-testid="sd-tab-snapshots"]');
    await expect(tabSnapshots).toBeVisible({ timeout: 5_000 });
    await tabSnapshots.click();
    await page.screenshot({ path: 'e2e/screenshots/admin-site-detail/snapshots-tab.png' });

    const snapshotsPanel = page.locator('[data-testid="site-snapshots-panel"]');
    await expect(snapshotsPanel).toBeVisible({ timeout: 5_000 });

    // The stubbed /snapshots response has one row — it must render with its AI name.
    const snapshotRow = page.locator('[data-testid="snapshot-row"]').first();
    await expect(snapshotRow).toBeVisible({ timeout: 5_000 });
    const aiName = page.locator('[data-testid="snapshot-ai-name"]').first();
    await expect(aiName).toBeVisible();
    expect(await aiName.textContent()).toBeTruthy();

    // Switch back to logs — panel state is preserved.
    const tabLogs = page.locator('[id="sd-tab-logs"], [data-testid="sd-tab-logs"]');
    await tabLogs.click();
    await expect(page.locator('[data-testid="site-logs-panel"]')).toBeVisible({ timeout: 5_000 });
    await page.screenshot({ path: 'e2e/screenshots/admin-site-detail/back-to-logs.png' });

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

    await page.route('**/api/sites/e2e-site-001/logs/tail**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ logs: [{ level: 'info', message: 'Build OK', timestamp: '2025-06-01T12:00:00Z' }] }),
      });
    });

    await page.route('**/api/sites/e2e-site-001/snapshots**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ snapshots: [] }),
      });
    });

    await page.route('**/api/sites/e2e-site-001/integrations**', (route) => {
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
    });

    await page.route('**/api/sites/e2e-site-001**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ site: SITE_OBJ }),
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
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    const tabIntegrations = page.locator('[id="sd-tab-integrations"], [data-testid="sd-tab-integrations"]');
    await expect(tabIntegrations).toBeVisible({ timeout: 10_000 });
    await tabIntegrations.click();
    await page.screenshot({ path: 'e2e/screenshots/admin-site-detail/integrations-tab.png' });

    const intPanel = page.locator('[data-testid="site-integrations-panel"]');
    await expect(intPanel).toBeVisible({ timeout: 5_000 });

    // Provider list is an unconditional container inside the panel, and
    // loadIntegrations falls back to DEFAULT_PROVIDERS on any failure — so at
    // least one provider card always renders.
    const providerList = page.locator('[data-testid="mcp-provider-list"]');
    await expect(providerList).toBeVisible({ timeout: 5_000 });
    const providerCard = page.locator('[data-testid^="mcp-provider-card-"]').first();
    await expect(providerCard).toBeVisible({ timeout: 5_000 });

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

    await page.route('**/api/sites/e2e-site-001/logs/tail**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ logs: [] }),
      });
    });
    await page.route('**/api/sites/e2e-site-001/snapshots**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ snapshots: [] }) });
    });
    await page.route('**/api/sites/e2e-site-001/integrations**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [] }) });
    });
    await page.route('**/api/sites/e2e-site-001**', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ site: SITE_OBJ }),
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
    await expect(page.locator('app-admin, [data-cockpit="v2"]')).toBeVisible({ timeout: 20_000 });
    await page.mouse.wheel(0, 200);

    // ?tab=sql is applied via queryParamMap → the SQL panel renders directly.
    const sqlPanel = page.locator('[data-testid="site-sql-panel"]');
    await expect(sqlPanel).toBeVisible({ timeout: 15_000 });

    // Editor + read-only affordances are static template inside the SQL panel.
    const sqlEditor = page.locator('[data-testid="sql-editor"]');
    await expect(sqlEditor).toBeVisible({ timeout: 5_000 });
    const readonlyPill = page.locator('[data-testid="sql-readonly-pill"], [data-testid="sql-safe-note"]').first();
    await expect(readonlyPill).toBeVisible();

    await page.screenshot({ path: 'e2e/screenshots/admin-site-detail/sql-deeplink.png' });

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
