/**
 * ADMIN-17 — /admin/bulk-ops Bulk Site Ops preview→confirm→apply flow renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * Covers the safety-preview surface of the bulk-ops feature: operation select,
 * the preview ("Preview impact") control, the set_flag conditional fields, and
 * the read-only-by-default contract (apply/confirm controls only appear after a
 * non-empty preview plan, so they are intentionally absent on first render).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-17 — /admin/bulk-ops Bulk Site Ops flow renders', () => {
  test('bulk-ops section, operation select, and preview control are visible', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/bulk-ops`);

    // Section heading
    await expect(page.locator('h2').filter({ hasText: /Bulk Site Ops/i }).first()).toBeVisible({ timeout: 15_000 });

    // Operation select renders with the three executors
    const opSelect = page.locator('[data-testid="bulk-ops-operation"]');
    await expect(opSelect).toBeVisible({ timeout: 10_000 });
    await expect(opSelect.locator('option')).toHaveCount(3);

    // Preview ("Preview impact") control is the entry point of the flow
    await expect(page.locator('[data-testid="bulk-ops-preview-btn"]')).toBeVisible({ timeout: 10_000 });

    // Read-only-by-default contract: confirm/apply controls only appear after a
    // non-empty previewed plan, so they must be absent on first render.
    await expect(page.locator('[data-testid="bulk-ops-apply-btn"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bulk-ops-confirm-apply"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="bulk-ops-result"]')).toHaveCount(0);

    expect(consoleErrors.filter(e => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED'))).toHaveLength(0);
  });

  test('selecting "Set a feature flag" reveals the flag-key + enabled fields', async ({ authedPage: page }) => {
    await page.goto(`${BASE}/admin/bulk-ops`);

    const opSelect = page.locator('[data-testid="bulk-ops-operation"]');
    await expect(opSelect).toBeVisible({ timeout: 15_000 });

    // set_flag fields are conditional — absent for the default 'archive' operation.
    await expect(page.locator('[data-testid="bulk-ops-setflag-fields"]')).toHaveCount(0);

    await opSelect.selectOption('set_flag');

    // Conditional fields appear: flag-key input + enabled checkbox.
    await expect(page.locator('[data-testid="bulk-ops-setflag-fields"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="bulk-ops-flagkey"]')).toBeVisible();
    await expect(page.locator('[data-testid="bulk-ops-enabled"]')).toBeVisible();
  });
});
