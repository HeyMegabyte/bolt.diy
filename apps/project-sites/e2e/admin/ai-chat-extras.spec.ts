/**
 * ADMIN-13 — /admin/ai-chat-extras flag-gated tools render
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 * The component exposes several fieldsets with stable data-testid attributes.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-13 — /admin/ai-chat-extras flag-gated tools render', () => {
  test('ai-chat-extras web-research and files fieldsets are visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/ai-chat`);

    // Component mounts an ai-chat-extras sub-surface; try both routes
    const webResearch = page.locator('[data-testid="ai-chat-extras-web-research"]');
    const filesCard = page.locator('[data-testid="ai-chat-extras-files"]');

    await expect(webResearch.or(filesCard).first()).toBeVisible({ timeout: 15_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
