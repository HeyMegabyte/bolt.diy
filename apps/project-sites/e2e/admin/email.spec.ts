/**
 * ADMIN-23 — /admin/email provider config saves
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-23 — /admin/email provider config renders', () => {
  test('email section heading visible and no console errors', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/email`);

    // data-testid added in this PR
    await expect(page.locator('[data-testid="email-section"]')).toBeVisible({ timeout: 15_000 });

    // Heading rendered by the component
    await expect(page.locator('h1').filter({ hasText: /E-mail|Email|Forms/i }).first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
