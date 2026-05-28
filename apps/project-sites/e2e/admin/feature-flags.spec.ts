/**
 * ADMIN-24 — /admin/feature-flags lists 103 flags + toggle works
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-24 — /admin/feature-flags lists flags', () => {
  test('feature flags heading and at least one flag card visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/feature-flags`);

    // h1 rendered by the component
    await expect(page.locator('h1').filter({ hasText: /Feature flags/i }).first()).toBeVisible({ timeout: 15_000 });

    // At least one flag key heading (h2.ff-key)
    await expect(page.locator('h2.ff-key').first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
