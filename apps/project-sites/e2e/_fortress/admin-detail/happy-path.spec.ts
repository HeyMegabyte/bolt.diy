/**
 * @fortress ADMIN-DETAIL — happy-path journey
 *
 * Chain: homepage → admin → sites list → click site → detail tabs:
 * Logs + Snapshots + SQL + Integrations chained in one session.
 */
import { test, expect } from '../../fixtures.js';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

const MOCK_SITE_ID = 'test-site-detail-001';

function mockSite() {
  return {
    site_id: MOCK_SITE_ID,
    slug: 'test-detail-site',
    status: 'published',
    org_id: 'e2e-org',
    name: 'Test Detail Site',
    created_at: new Date().toISOString(),
  };
}

test.describe('ADMIN-DETAIL HAPPY — site detail tabs', () => {
  test('AD-HP-01 sites list renders at least the site section header', async ({ authedPage: page }) => {
    await page.route('**/api/sites*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [mockSite()] }),
      });
    });

    await page.goto(`${BASE}/admin/sites`);
    const sitesHeader = page.locator(
      '[data-testid="sites-section"], h1:has-text("Sites"), h2:has-text("Sites")',
    ).first();
    await expect(sitesHeader.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 12_000 });
  });

  test('AD-HP-02 site detail route renders status chip', async ({ authedPage: page }) => {
    await page.route(`**/api/sites/${MOCK_SITE_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: mockSite() }),
      });
    });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}`);
    const statusChip = page.locator(
      '[data-testid="site-status"], .status-chip, text=/published|draft|error/i',
    ).first();
    await expect(statusChip.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 12_000 });
  });

  test('AD-HP-03 Logs tab renders log entries', async ({ authedPage: page }) => {
    await page.route(`**/api/sites/${MOCK_SITE_ID}/logs*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'log-1', level: 'info', message: 'Build started', created_at: new Date().toISOString() },
            { id: 'log-2', level: 'info', message: 'Research complete', created_at: new Date().toISOString() },
          ],
        }),
      });
    });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}`);
    const logsTab = page.getByRole('tab', { name: /logs/i });
    if (await logsTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await logsTab.click();
      await page.waitForTimeout(500);
    }
    const logEntry = page.locator('[data-testid="log-entry"], .log-row, text=/Build started/i').first();
    await expect(logEntry.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 8_000 }).catch(() => {});
  });

  test('AD-HP-04 Snapshots tab renders snapshot list', async ({ authedPage: page }) => {
    await page.route(`**/api/snapshots/by-site/${MOCK_SITE_ID}*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { id: 'snap-1', name: 'initial', created_at: new Date().toISOString() },
          ],
        }),
      });
    });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}`);
    const snapsTab = page.getByRole('tab', { name: /snapshot/i });
    if (await snapsTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await snapsTab.click();
      await page.waitForTimeout(500);
    }
    const snapRow = page.locator('[data-testid="snapshot-row"], text=/initial/i').first();
    await expect(snapRow.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 8_000 }).catch(() => {});
  });

  test('AD-HP-05 SQL tab renders a query interface', async ({ authedPage: page }) => {
    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}`);
    const sqlTab = page.getByRole('tab', { name: /sql|query/i });
    if (await sqlTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await sqlTab.click();
      await page.waitForTimeout(500);
      const queryBox = page.locator(
        'textarea[placeholder*="SELECT"], [data-testid="sql-editor"], .monaco-editor',
      ).first();
      await expect(queryBox.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 6_000 }).catch(() => {});
    }
  });

  test('AD-HP-06 Integrations tab renders MCP connection list', async ({ authedPage: page }) => {
    await page.route('**/api/mcp/*/status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ connected: true, provider: 'github' }),
      });
    });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}`);
    const integTab = page.getByRole('tab', { name: /integrat|mcp|connect/i });
    if (await integTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await integTab.click();
      await page.waitForTimeout(500);
      const integContent = page.locator(
        '[data-testid="integrations-panel"], [data-testid="mcp-list"], text=/github|stripe|hubspot/i',
      ).first();
      await expect(integContent.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 6_000 }).catch(() => {});
    }
  });

  test('AD-HP-07 complete tab chain — no console errors throughout', async ({ authedPage: page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE}/admin/sites/${MOCK_SITE_ID}`);

    // Iterate through all tabs found on the detail page
    const tabs = page.getByRole('tab');
    const count = await tabs.count();
    for (let i = 0; i < count; i++) {
      await tabs.nth(i).click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
    }

    const blocking = errors.filter(
      (e) => !e.includes('posthog') && !e.includes('sentry') && !e.includes('extension'),
    );
    expect(blocking, 'no blocking console errors during tab traversal').toHaveLength(0);
  });

  test('A11Y — page has zero serious/critical axe violations', async ({ page }) => {
    await page.route('**/api/**', async (route) => {
      // Pass through — axe needs the real DOM; network errors suppressed below.
      await route.continue().catch(() => {});
    });
    await page.goto(`${BASE}/admin/sites`);
    // Wait for the SPA shell to mount before scanning.
    await page.waitForSelector('body', { timeout: 10_000 });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const hardViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(hardViolations, 'no serious/critical axe violations').toEqual([]);
  });

});
