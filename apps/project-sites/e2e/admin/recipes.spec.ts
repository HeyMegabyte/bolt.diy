/**
 * ADMIN-23 — /admin/recipes Automation Builder surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The recipes section ({@link AdminRecipesComponent}, mounted at
 * `/admin/recipes`) ALWAYS renders its header (kicker "Automations" + "Automation
 * Builder" h2 + blurb). The management surface lives inside `@if (site())`: the
 * create form (name input + trigger select + action select + "Create automation"
 * button) and the recipe list. When no site is selected, the component shows a
 * `recipes-empty` prompt instead. The backend (`/api/sites/:siteId/recipes`) is
 * flag-gated (`automation_builder`) — a 404 surfaces a friendly error inside the
 * management surface.
 *
 * To stay deterministic + parallel-safe across either state, this spec asserts
 * the always-rendered header hard, then branches on whether a site is selected
 * — mirroring the env-tolerant pattern in webhooks.spec.ts / enterprise.spec.ts:
 * when a site resolves, assert the create control; otherwise assert the
 * empty-state prompt. Deterministic (locator waits only), parallel-safe
 * (isolated authed context), stable selectors (data-testid / role / text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-23 — /admin/recipes Automation Builder surface renders', () => {
  test('recipes header + create control / empty-state render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/recipes`);

    // Always-rendered header — the section shell mounts regardless of site/flag state.
    await expect(
      page.locator('h2').filter({ hasText: /Automation Builder/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Branch on whether a site is selected. With a site → the create control
    // (name input + trigger/action selects + "Create automation" button)
    // renders. Without one → the empty-state prompt renders. Either is a valid,
    // deterministic state.
    const nameInput = page.locator('[data-testid="recipes-name"]').first();
    if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Site selected: the create form is present.
      await expect(nameInput).toBeVisible();
      await expect(page.locator('[data-testid="recipes-trigger"]').first()).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('[data-testid="recipes-action"]').first()).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('[data-testid="recipes-create-btn"]').first()).toBeVisible({ timeout: 5_000 });
    } else {
      // No site selected in this env — the empty-state prompt is shown instead.
      await expect(page.locator('[data-testid="recipes-empty"]').first()).toBeVisible({ timeout: 5_000 });
    }

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
