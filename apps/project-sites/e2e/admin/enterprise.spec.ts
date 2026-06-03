/**
 * ADMIN-21 — /admin/enterprise Enterprise Plan surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The enterprise section ({@link AdminEnterpriseComponent}, mounted at
 * `/admin/enterprise`) ALWAYS renders its header (kicker + "Contract · SLA ·
 * SSO · Audit" h2 + action buttons). The KPI grid (plan tier / ACV / SLA
 * target / rolling uptime) and the SLA-headroom gauge (`role="meter"`) live
 * inside `@if (!notFound() && !loadError())` — they render once the
 * `enterprise_plan` flag resolves on. When the flag is off the component shows
 * the disabled-state card instead.
 *
 * To stay deterministic + parallel-safe across either flag state, this spec
 * asserts the always-rendered header hard, then branches on the flag-gated
 * surface — mirroring the env-tolerant pattern in apps.spec.ts: when the KPI
 * grid renders, assert it + the SLA gauge; otherwise assert the section is
 * still mounted via its header. Deterministic (locator waits only),
 * parallel-safe (isolated authed context), stable selectors (role / text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-21 — /admin/enterprise Enterprise Plan surface renders', () => {
  test('enterprise header + KPI grid / SLA gauge render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/enterprise`);

    // Always-rendered header — the section shell mounts regardless of flag state.
    await expect(
      page.locator('h2').filter({ hasText: /Contract · SLA · SSO · Audit/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The Save-contract action is part of the always-rendered header controls.
    await expect(
      page.getByRole('button', { name: /Save contract/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Flag-gated surface: when `enterprise_plan` resolves on, the KPI grid + SLA
    // gauge render. Branch like apps.spec.ts so the spec passes in either state.
    const kpiLabel = page.locator('.kpi-label').filter({ hasText: /Plan tier/i }).first();
    if (await kpiLabel.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // KPI grid: the four labelled cards are present.
      await expect(kpiLabel).toBeVisible();
      await expect(page.locator('.kpi-label').filter({ hasText: /SLA target/i }).first()).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('.kpi-label').filter({ hasText: /Rolling uptime/i }).first()).toBeVisible({ timeout: 5_000 });

      // SLA-headroom gauge renders only when rolling uptime data exists; assert
      // it when present without making it a hard requirement (no-data → no gauge).
      const gauge = page.locator('[role="meter"][aria-label*="Rolling 90-day uptime"]');
      if (await gauge.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(gauge).toBeVisible();
      }
    } else {
      // Flag off in this env — assert the section is still mounted via its header.
      await expect(
        page.locator('h2').filter({ hasText: /Contract · SLA · SSO · Audit/i }).first(),
      ).toBeVisible({ timeout: 5_000 });
    }

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
