/**
 * ADMIN-16 — /admin/analytics Pulse analytics renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-16 — /admin/analytics Pulse analytics renders', () => {
  test('analytics section heading and KPI cards are visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/analytics`);

    // Section heading contains "Analytics"
    await expect(page.locator('h2').filter({ hasText: /Analytics/i }).first()).toBeVisible({ timeout: 15_000 });

    // At least one KPI card rendered
    await expect(page.locator('[data-testid="kpi-pageviews"]')).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
