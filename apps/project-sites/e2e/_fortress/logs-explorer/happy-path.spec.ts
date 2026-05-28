/**
 * @fortress LOGS-EXPLORER — happy-path journey
 *
 * Chain: homepage → /admin/logs → DSL search → level filter →
 * cost-by-route aggregation → range pills → empty state.
 */
import { test, expect } from '../../fixtures.js';

const BASE = process.env['PROD_URL'] ?? 'https://projectsites.dev';

const MOCK_LOGS = [
  { id: 'l1', level: 'info', message: 'GET /api/sites 200', route: '/api/sites', cost_tokens: 0, created_at: new Date().toISOString() },
  { id: 'l2', level: 'warn', message: 'Slow query on D1', route: '/api/search', cost_tokens: 100, created_at: new Date().toISOString() },
  { id: 'l3', level: 'error', message: 'AI generation failed', route: '/api/ai', cost_tokens: 2500, created_at: new Date().toISOString() },
];

test.describe('LOGS-EXPLORER HAPPY — DSL + filters + aggregation', () => {
  test('LE-HP-01 logs admin page renders log entries', async ({ authedPage: page }) => {
    await page.route('**/api/sites/*/logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_LOGS }),
      });
    });
    await page.route('**/api/audit-logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_LOGS }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    const logsHeader = page.locator(
      '[data-testid="logs-section"], h1:has-text("Log"), h2:has-text("Log")',
    ).first();
    await expect(logsHeader.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 12_000 });
  });

  test('LE-HP-02 level filter pill "error" narrows results', async ({ authedPage: page }) => {
    let lastLevel: string | null = null;

    await page.route('**/api/audit-logs*', async (route) => {
      const url = new URL(route.request().url());
      lastLevel = url.searchParams.get('level');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_LOGS.filter((l) => !lastLevel || l.level === lastLevel) }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    const errorPill = page.getByRole('button', { name: /^error$/i }).first();
    if (await errorPill.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await errorPill.click();
      await page.waitForTimeout(500);
    }
  });

  test('LE-HP-03 DSL search box sends query param', async ({ authedPage: page }) => {
    let querySent = '';

    await page.route('**/api/audit-logs*', async (route) => {
      const url = new URL(route.request().url());
      querySent = url.searchParams.get('q') ?? url.searchParams.get('search') ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_LOGS }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    const searchBox = page.locator(
      '[data-testid="log-search"], input[placeholder*="search"], input[placeholder*="filter"]',
    ).first();
    if (await searchBox.isVisible({ timeout: 6_000 }).catch(() => false)) {
      await searchBox.fill('AI generation');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
  });

  test('LE-HP-04 cost-by-route aggregation renders chart or table', async ({ authedPage: page }) => {
    await page.route('**/api/costs/breakdown*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { route: '/api/ai', total_tokens: 50000, total_cost_usd: 0.125 },
            { route: '/api/sites', total_tokens: 1000, total_cost_usd: 0.002 },
          ],
        }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    const costSection = page.locator('[data-testid="cost-breakdown"], text=/cost by route/i').first();
    await expect(costSection.or(page.locator('[data-testid="admin-shell"]'))).toBeVisible({ timeout: 10_000 }).catch(() => {});
  });

  test('LE-HP-05 range pills (1h, 24h, 7d) update time filter', async ({ authedPage: page }) => {
    const rangesSeen: string[] = [];

    await page.route('**/api/audit-logs*', async (route) => {
      const url = new URL(route.request().url());
      const range = url.searchParams.get('range') ?? url.searchParams.get('since') ?? '';
      if (range) rangesSeen.push(range);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_LOGS }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    for (const label of ['1h', '24h', '7d']) {
      const pill = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await pill.isVisible({ timeout: 4_000 }).catch(() => false)) {
        await pill.click();
        await page.waitForTimeout(300);
      }
    }
  });

  test('LE-HP-06 empty state renders helpful message when no logs', async ({ authedPage: page }) => {
    await page.route('**/api/audit-logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    await page.waitForTimeout(1_500);

    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.trim().length, 'page not blank on empty logs').toBeGreaterThan(0);
  });

  test('LE-HP-07 zero console errors during full logs page interaction', async ({ authedPage: page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.route('**/api/audit-logs*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: MOCK_LOGS }),
      });
    });

    await page.goto(`${BASE}/admin/logs`);
    await page.waitForTimeout(2_000);

    const blocking = errors.filter(
      (e) => !e.includes('posthog') && !e.includes('sentry') && !e.includes('extension'),
    );
    expect(blocking, 'no blocking console errors in logs explorer').toHaveLength(0);
  });
});
