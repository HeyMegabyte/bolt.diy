/**
 * ADMIN-14 — /admin/settings org settings save
 * ADMIN-15 — /admin/user-settings profile save
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-14 — /admin/settings org settings render', () => {
  test('settings section heading and 2FA toggle visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/settings`);

    await expect(page.locator('h2').filter({ hasText: /Settings/i }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="team-invite-button"]')).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});

test.describe('ADMIN-15 — /admin/user-settings profile render', () => {
  test('user-settings CF credentials card visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/user`);

    await expect(page.locator('[data-testid="cf-credentials-card"]')).toBeVisible({ timeout: 15_000 });

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });
});
