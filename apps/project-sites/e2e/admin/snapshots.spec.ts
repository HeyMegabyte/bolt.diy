/**
 * ADMIN-05 — /admin/snapshots lists snapshots with capture/preview buttons
 * ADMIN-06 — /admin/snapshots-diff compares two snapshots side-by-side
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-05 — /admin/snapshots lists snapshots', () => {
  test('snapshots section heading and create button are visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/snapshots`);

    // Heading rendered by the component
    await expect(page.locator('h2').filter({ hasText: /Snapshots/i }).first()).toBeVisible({ timeout: 15_000 });

    // Primary CTA must be present
    await expect(page.locator('[data-testid="snapshot-create-button"]')).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});

test.describe('ADMIN-06 — /admin/snapshots-diff compares snapshots', () => {
  test('snapshots-diff section heading is visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/snapshots-diff`);

    // Root element with testid added in this PR
    await expect(page.locator('[data-testid="snapshots-diff-section"]')).toBeVisible({ timeout: 15_000 });

    // Heading
    await expect(page.locator('h1').filter({ hasText: /Snapshot diff/i }).first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
