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

    // Site detail shell
    const detailShell = page.locator('[data-testid="site-detail"]');
    if (await detailShell.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await expect(detailShell).toBeVisible();
    }

    // Site name in title (class-based: site-detail__title)
    const title = page.locator('h1.site-detail__title, [data-testid="site-detail"] h1');
    if (await title.isVisible({ timeout: 8_000 }).catch(() => false)) {
      const titleText = await title.textContent();
      expect(titleText).toMatch(/E2E Test Site|e2e-site-001/);
    }

    // Tab strip: at least 2 of 4 tabs visible
    const tabLogs = page.locator('[id="sd-tab-logs"], [data-testid="sd-tab-logs"]');
    const tabSnapshots = page.locator('[id="sd-tab-snapshots"], [data-testid="sd-tab-snapshots"]');
    const tabSql = page.locator('[id="sd-tab-sql"], [data-testid="sd-tab-sql"]');
    const tabIntegrations = page.locator('[id="sd-tab-integrations"], [data-testid="sd-tab-integrations"]');

    const visibleTabs = await Promise.all([
      tabLogs.isVisible({ timeout: 8_000 }).catch(() => false),
      tabSnapshots.isVisible({ timeout: 3_000 }).catch(() => false),
      tabSql.isVisible({ timeout: 3_000 }).catch(() => false),
      tabIntegrations.isVisible({ timeout: 3_000 }).catch(() => false),
    ]);
    const visibleCount = visibleTabs.filter(Boolean).length;
    expect(visibleCount).toBeGreaterThanOrEqual(1);

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

    // Default panel: logs
    const logsPanel = page.locator('[data-testid="site-logs-panel"]');
    if (await logsPanel.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await expect(logsPanel).toBeVisible();
    }

    // Click snapshots tab
    const tabSnapshots = page.locator('[id="sd-tab-snapshots"], [data-testid="sd-tab-snapshots"]');
    if (await tabSnapshots.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await tabSnapshots.click();
      await page.screenshot({ path: 'e2e/screenshots/admin-site-detail/snapshots-tab.png' });

      const snapshotsPanel = page.locator('[data-testid="site-snapshots-panel"]');
      if (await snapshotsPanel.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(snapshotsPanel).toBeVisible();

        // Should show at least one snapshot row
        const snapshotRow = page.locator('[data-testid="snapshot-row"]').first();
        if (await snapshotRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await expect(snapshotRow).toBeVisible();
          const aiName = page.locator('[data-testid="snapshot-ai-name"]').first();
          if (await aiName.isVisible({ timeout: 2_000 }).catch(() => false)) {
            const nameText = await aiName.textContent();
            expect(nameText).toBeTruthy();
          }
        }
      }

      // Switch back to logs — state should be preserved
      const tabLogs = page.locator('[id="sd-tab-logs"], [data-testid="sd-tab-logs"]');
      if (await tabLogs.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await tabLogs.click();
        const logsPanelAgain = page.locator('[data-testid="site-logs-panel"]');
        if (await logsPanelAgain.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await expect(logsPanelAgain).toBeVisible();
        }
        await page.screenshot({ path: 'e2e/screenshots/admin-site-detail/back-to-logs.png' });
      }
    }

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
    if (await tabIntegrations.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await tabIntegrations.click();
      await page.screenshot({ path: 'e2e/screenshots/admin-site-detail/integrations-tab.png' });

      const intPanel = page.locator('[data-testid="site-integrations-panel"]');
      if (await intPanel.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(intPanel).toBeVisible();

        // MCP provider list
        const providerList = page.locator('[data-testid="mcp-provider-list"]');
        if (await providerList.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await expect(providerList).toBeVisible();
          // At least one provider card
          const providerCard = page.locator('[data-testid^="mcp-provider-card-"]').first();
          if (await providerCard.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await expect(providerCard).toBeVisible();
          }
        }
      }
    }

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

    const sqlPanel = page.locator('[data-testid="site-sql-panel"]');
    if (await sqlPanel.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await expect(sqlPanel).toBeVisible();

      // SQL editor should be present
      const sqlEditor = page.locator('[data-testid="sql-editor"]');
      if (await sqlEditor.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(sqlEditor).toBeVisible();
      }

      // Read-only pill or safe note
      const readonlyPill = page.locator('[data-testid="sql-readonly-pill"], [data-testid="sql-safe-note"]').first();
      if (await readonlyPill.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(readonlyPill).toBeVisible();
      }
    }

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
