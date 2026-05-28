/**
 * ADMIN-31 — /admin/accept-invite org invitation acceptance
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 * The component immediately tries to verify a token; without a valid token it
 * shows an error state. We assert the section mounts and the error state heading
 * is visible (which it always is when `?token=` is missing).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-31 — /admin/accept-invite org invitation acceptance renders', () => {
  test('accept-invite section root mounts and shows a state heading', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/accept-invite`);

    // data-testid added in this PR
    await expect(page.locator('[data-testid="accept-invite-section"]')).toBeVisible({ timeout: 15_000 });

    // One of the three state headings must be present
    const headings = page.locator('h2').filter({
      hasText: /Verifying invite|Joined|Couldn't accept/i,
    });
    await expect(headings.first()).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('net::ERR_BLOCKED') &&
      // token error from API is expected in this test scenario
      !e.includes('invite')
    )).toHaveLength(0);
  });
});
