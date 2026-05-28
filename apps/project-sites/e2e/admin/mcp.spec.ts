/**
 * ADMIN-17 — /admin/mcp MCP provider list + connect buttons render
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-17 — /admin/mcp MCP provider list renders', () => {
  test('MCP section heading and at least one provider card visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/mcp`);

    // Section heading
    await expect(page.locator('h2').filter({ hasText: /MCP|Integration/i }).first()).toBeVisible({ timeout: 15_000 });

    // At least one provider card (dynamic testid based on provider id)
    await expect(page.locator('[data-testid^="mcp-card-"]').first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
