/**
 * ADMIN-22 — /admin/webhooks Outbound Webhooks surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The webhooks section ({@link AdminWebhooksComponent}, mounted at
 * `/admin/webhooks`) ALWAYS renders its header (kicker + "Outbound Webhooks"
 * h2 + blurb). The management surface lives inside `@if (site())`: the
 * add-endpoint form (https URL input + event checkboxes + "Add endpoint"
 * button), the endpoint list, and recent-deliveries. When no site is selected,
 * the component shows a `webhooks-empty` prompt instead. The backend
 * (`/api/sites/:siteId/webhooks`) is flag-gated (`outbound_webhooks`) — 404
 * surfaces a friendly "not enabled" error inside the management surface.
 *
 * To stay deterministic + parallel-safe across either state, this spec asserts
 * the always-rendered header hard, then branches on whether a site is selected
 * — mirroring the env-tolerant pattern in enterprise.spec.ts / apps.spec.ts:
 * when a site resolves, assert the add-endpoint control; otherwise assert the
 * empty-state prompt. Deterministic (locator waits only), parallel-safe
 * (isolated authed context), stable selectors (data-testid / role / text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-22 — /admin/webhooks Outbound Webhooks surface renders', () => {
  test('webhooks header + add-endpoint control / empty-state render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/webhooks`);

    // Always-rendered header — the section shell mounts regardless of site/flag state.
    await expect(
      page.locator('h2').filter({ hasText: /Outbound Webhooks/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Branch on whether a site is selected. With a site → the add-endpoint
    // control (https URL input + "Add endpoint" button) renders. Without one →
    // the empty-state prompt renders. Either is a valid, deterministic state.
    const urlInput = page.locator('[data-testid="webhooks-url"]').first();
    if (await urlInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Site selected: the create form is present.
      await expect(urlInput).toBeVisible();
      await expect(page.locator('[data-testid="webhooks-create-btn"]').first()).toBeVisible({ timeout: 5_000 });
      // At least one event checkbox from the WEBHOOK_EVENT_TYPES allowlist.
      await expect(page.locator('[data-testid="webhooks-event-site.published"]').first()).toBeVisible({ timeout: 5_000 });
    } else {
      // No site selected in this env — the empty-state prompt is shown instead.
      await expect(page.locator('[data-testid="webhooks-empty"]').first()).toBeVisible({ timeout: 5_000 });
    }

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
