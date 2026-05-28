/**
 * ADMIN-29 — /admin/seo per-site SEO panel renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-29 — /admin/seo per-site SEO panel renders', () => {
  test('seo section data-testid root and heading visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/seo`);

    // data-testid added in this PR
    await expect(page.locator('[data-testid="seo-section"]')).toBeVisible({ timeout: 15_000 });

    await expect(page.locator('h2').filter({ hasText: /SEO/i }).first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
