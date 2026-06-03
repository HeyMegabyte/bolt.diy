/**
 * ADMIN — /admin/deliverability Email Deliverability Wizard renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The surface has two always-present roots depending on whether a site is
 * selected: the empty-state prompt (`deliverability-empty`) when no site is
 * selected, or the domain input + Check button (`deliverability-domain` +
 * `deliverability-check-btn`) when one is. The score meter + SPF/DKIM/DMARC
 * rows only render after a live DNS lookup, so this spec asserts the heading,
 * the intro copy that names SPF/DKIM/DMARC, and whichever always-rendered root
 * is present — deterministic regardless of selected-site state.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN — /admin/deliverability Email Deliverability Wizard renders', () => {
  test('deliverability heading, SPF/DKIM/DMARC intro and check surface visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/deliverability`);

    // Section heading
    await expect(
      page.locator('h2').filter({ hasText: /Email Deliverability/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Intro copy names the three records the wizard checks
    await expect(
      page.getByText(/SPF, DKIM and DMARC/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Exactly one of the two always-present roots renders depending on whether
    // a site is selected: the empty-state prompt OR the domain input + Check
    // button. Assert at least one is visible (deterministic, state-agnostic).
    const emptyState = page.locator('[data-testid="deliverability-empty"]');
    const domainInput = page.locator('[data-testid="deliverability-domain"]');
    const checkBtn = page.locator('[data-testid="deliverability-check-btn"]');

    await expect
      .poll(
        async () =>
          (await emptyState.isVisible()) ||
          ((await domainInput.isVisible()) && (await checkBtn.isVisible())),
        { timeout: 10_000 },
      )
      .toBe(true);

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
