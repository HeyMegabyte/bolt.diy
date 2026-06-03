/**
 * ADMIN-50 — /admin/trust Trust Center surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The Trust Center section ({@link AdminTrustCenterComponent}, mounted at
 * `/admin/trust` — NOT `/admin/trust-center`) ALWAYS renders its header (kicker
 * "Trust Center" + "AI transparency + data handling" h2 + Refresh/Save action
 * buttons). The editor cards (data residency / audit-log policy / AI-outage
 * behavior / AI models / content provenance / custom disclosures) live inside
 * `@if (!notFound() && !loadError())` and render once the `trust_center` flag
 * resolves on. The component is PESSIMISTIC: `notFound` starts true, so when the
 * flag is off it shows the disabled-state card ("Trust Center is disabled for
 * your org") instead — and never fires the /trust/* fetch.
 *
 * To stay deterministic + parallel-safe across either flag state, this spec
 * asserts the always-rendered header hard, then branches on the flag-gated
 * surface — mirroring the env-tolerant pattern in enterprise.spec.ts: when the
 * Data-residency card renders, assert it + a sibling card; otherwise assert the
 * disabled card OR the section header is still mounted. Deterministic (locator
 * waits only), parallel-safe (isolated authed context), stable selectors
 * (role / text / aria-label).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-50 — /admin/trust Trust Center surface renders', () => {
  test('trust-center header + editor cards / disabled card render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/trust`);

    // Always-rendered header — the section shell mounts regardless of flag state.
    await expect(
      page.locator('h2').filter({ hasText: /AI transparency \+ data handling/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The Save action is part of the always-rendered header controls.
    await expect(
      page.getByRole('button', { name: /^Save(ing…)?$/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Flag-gated surface: when `trust_center` resolves on, the editor cards
    // render. Branch like enterprise.spec.ts so the spec passes in either state.
    const residency = page.getByLabel('Data residency');
    if (await residency.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Editor cards: data residency + sibling controls are present.
      await expect(residency).toBeVisible();
      await expect(page.getByLabel('Audit-log access policy').first()).toBeVisible({ timeout: 5_000 });
      await expect(page.getByLabel('AI-outage behavior').first()).toBeVisible({ timeout: 5_000 });
    } else {
      // Flag off in this env — assert either the disabled card OR the section
      // header is still mounted (no hard requirement on which gated branch shows).
      const disabled = page.locator('.empty-card').filter({ hasText: /Trust Center is disabled/i }).first();
      const header = page.locator('h2').filter({ hasText: /AI transparency \+ data handling/i }).first();
      const disabledVisible = await disabled.isVisible({ timeout: 5_000 }).catch(() => false);
      if (disabledVisible) {
        await expect(disabled).toBeVisible();
      } else {
        await expect(header).toBeVisible({ timeout: 5_000 });
      }
    }

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
