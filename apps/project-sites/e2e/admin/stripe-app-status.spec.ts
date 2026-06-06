/**
 * ADMIN-33 — /admin/stripe-app-status Stripe App Marketplace status renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The Stripe App Status panel ({@link AdminStripeAppStatusComponent}, mounted at
 * `/admin/stripe-app-status`) ALWAYS renders its "Stripe App Marketplace" kicker
 * + section header. The body branches: `notFound()` → a disabled empty-card
 * (feature flag off, pessimistic until resolved), `loadError()` →
 * `stripe-app-load-error` (with a retry), `summary()` → the KPI grid
 * (Total installs, etc.).
 *
 * To stay deterministic + parallel-safe across every state, this spec asserts
 * the always-rendered kicker hard, then tolerates whichever body state renders
 * — mirroring enterprise.spec.ts / webhooks.spec.ts. Deterministic (locator
 * waits only), parallel-safe (isolated authed context), stable selectors.
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-33 — /admin/stripe-app-status Stripe App Marketplace renders', () => {
  test('stripe-app-status kicker + body (empty / error / summary) render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/stripe-app-status`);

    // Always-rendered header kicker — mounts regardless of flag/load state.
    await expect(
      page.locator('.kicker').filter({ hasText: /Stripe App Marketplace/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Tolerant body branch: one of disabled-empty-card / load-error / KPI summary
    // is present. The error state exposes a stable testid; the others render an
    // .empty-card or the .kpi-label grid. Assert at least one renders.
    const loadError = page.locator('[data-testid="stripe-app-load-error"]').first();
    if (await loadError.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(loadError).toBeVisible();
      // The error banner now renders via the shared <app-inline-error> primitive,
      // whose retry button carries data-testid="inline-error-retry".
      await expect(page.locator('[data-testid="inline-error-retry"]').first()).toBeVisible();
    } else {
      // Either the disabled empty-card or the resolved KPI summary grid.
      await expect(
        page.locator('.empty-card, .kpi-label').first(),
      ).toBeVisible({ timeout: 5_000 });
    }

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
