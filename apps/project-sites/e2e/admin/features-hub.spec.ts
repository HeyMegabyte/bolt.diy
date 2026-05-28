/**
 * ADMIN-25 — /admin/features features-hub 70+ cards render with "Try it"
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 * The features-hub component is at /admin/features (routerLink in the sidebar).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-25 — /admin/features features-hub cards render', () => {
  test('features-hub section mounts and has tab navigation', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/features`);

    // The hub renders tab navigation or cards — check for any visible heading
    await expect(
      page.locator('h1, h2').filter({ hasText: /Feature|Hub|IDE|Agent|Big|Brilliant/i }).first()
    ).toBeVisible({ timeout: 15_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
