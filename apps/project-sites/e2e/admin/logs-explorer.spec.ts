/**
 * ADMIN-LOGS — /admin/logs Worker Tail Log Explorer renders
 *
 * The `/admin/logs` route mounts {@link AdminLogsExplorerComponent} — the
 * Observability section with a header (kicker + "Log Explorer" heading), a row
 * of time-range pills (1h / 6h / 24h / 7d / 30d), a DSL search bar, level
 * filter chips, a cost-by-route chart, and a results table.
 *
 * The header + range pills render UNCONDITIONALLY (they live outside the
 * `@if (featureDisabled())` gate). The search bar + level chips only render
 * when the `log_explorer` flag is on (the `@else` branch); when off, an
 * "isn't enabled" empty-card renders instead. So the deterministic, always-true
 * assertions target the header + range pills; the search/level controls are
 * asserted flag-aware (present when the explorer body — not the disabled card —
 * is showing).
 *
 * Per [[e2e-tdd-organization]]: goto('/') (via authedPage fixture) → navigate
 * to the sub-route → assert the always-rendered shell + controls.
 *
 * Deterministic (locator waits only, no sleeps), parallel-safe (isolated authed
 * context), stable selectors (kicker/heading text + .range-pill class + chip text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

test.describe('ADMIN-LOGS — /admin/logs Log Explorer renders', () => {
  test('explorer header, Observability kicker, and range pills are visible', async ({
    authedPage: page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/logs`);

    // Section heading — always rendered, regardless of the log_explorer flag.
    await expect(
      page.locator('h2').filter({ hasText: /Log Explorer/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // "Observability" kicker above the heading — always rendered.
    await expect(page.locator('.kicker').filter({ hasText: /Observability/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    // The five time-range pills live in the header (outside the feature gate),
    // so they render in both the enabled and disabled states.
    for (const r of ['1h', '6h', '24h', '7d', '30d']) {
      await expect(
        page.locator('button.range-pill').filter({ hasText: new RegExp(`^${r}$`) }).first(),
      ).toBeVisible({ timeout: 10_000 });
    }

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });

  test('search bar and level filter chips render when the explorer body is shown', async ({
    authedPage: page,
  }) => {
    await page.goto(`${BASE}/admin/logs`);

    // Wait for the section to settle (header is always present).
    await expect(
      page.locator('h2').filter({ hasText: /Log Explorer/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The DSL search input + level chips render only when the log_explorer flag
    // is on (the `@else` branch). When the flag is off, the "isn't enabled"
    // empty-card renders instead. Assert flag-aware so the spec is deterministic
    // in both states: exactly one of the two branches is visible.
    const searchInput = page.locator('input[hlmInput], .search-bar input').first();
    const disabledCard = page.locator('.empty-card').filter({ hasText: /isn.t enabled/i }).first();

    await expect(searchInput.or(disabledCard)).toBeVisible({ timeout: 10_000 });

    if (await searchInput.isVisible().catch(() => false)) {
      // Explorer body is live — assert the DSL search bar + level filter chips.
      await expect(searchInput).toBeVisible();

      for (const label of ['Debug', 'Info', 'Warn', 'Error', 'Fatal']) {
        await expect(
          page.locator('button.chip').filter({ hasText: new RegExp(`^\\s*●\\s*${label}$`) }).first(),
        ).toBeVisible({ timeout: 10_000 });
      }

      // The "$ Cost by Route" ghost chip is always present in the explorer body.
      await expect(
        page.locator('button.chip').filter({ hasText: /Cost by Route/i }).first(),
      ).toBeVisible({ timeout: 10_000 });
    } else {
      // Flag is off — the disabled card links to Feature Flags to enable it.
      await expect(disabledCard).toBeVisible();
      await expect(
        disabledCard.getByRole('link', { name: /Feature Flags/i }),
      ).toBeVisible({ timeout: 10_000 });
    }
  });
});
