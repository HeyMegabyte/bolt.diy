/**
 * ADMIN-28 — /admin/voice Twilio voice/SMS config renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-28 — /admin/voice Twilio voice/SMS config renders', () => {
  test('voice section heading and tab navigation visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/voice`);

    // data-testid added in this PR
    await expect(page.locator('[data-testid="voice-section"]')).toBeVisible({ timeout: 15_000 });

    // Tab navigation renders (data-testid pattern: voice-tab-*)
    await expect(page.locator('[data-testid^="voice-tab-"]').first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
