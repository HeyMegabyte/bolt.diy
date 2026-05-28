/**
 * ADMIN-26 — /admin/social Pulse social posting UI
 * ADMIN-27 — /admin/social-analytics aggregate dashboards
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-26 — /admin/social Pulse social posting UI renders', () => {
  test('social section h1 and auto-pilot button visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/social`);

    // h1.social-h1 rendered by the component
    await expect(page.locator('h1.social-h1, h1').filter({ hasText: /Social|Pulse/i }).first()).toBeVisible({ timeout: 15_000 });

    // Composer or auto-pilot button
    await expect(
      page.locator('[data-testid="social-auto-pilot-prompt-btn"]').or(
        page.locator('[data-testid="social-composer-textarea"]')
      ).first()
    ).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});

test.describe('ADMIN-27 — /admin/social-analytics aggregate dashboards render', () => {
  test('social-analytics section heading and data-testid visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/social-analytics`);

    // data-testid added in this PR
    await expect(page.locator('[data-testid="social-analytics-section"]')).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('h1').filter({ hasText: /Social analytics/i }).first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
