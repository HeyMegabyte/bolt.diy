/**
 * ADMIN-30 — /admin/sites/:id/copilot Multimodal AI Site Copilot surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The site-copilot section ({@link AdminSiteCopilotComponent}, mounted at
 * `/admin/sites/:id/copilot`) ALWAYS renders its `.copilot-shell` header band
 * regardless of API / flag state: the "Site Copilot" eyebrow, the
 * "Multimodal AI Copilot" h2, the blurb, and the enable toggle
 * (a checkbox with aria-label "Copilot enabled" / "Copilot disabled").
 * These mount synchronously from the template before the
 * `GET /api/sites/:id/copilot/{config,sessions}` fetches resolve.
 *
 * Below the always-rendered header the section shows exactly ONE of:
 *   - a flag-gate notice (`.copilot-flag-gate` + "multimodal_copilot" code)
 *     when `GET /copilot/config` 404s (flag disabled — the honest state), OR
 *   - the management surface: the embed snippet (slug-gated), the stats row
 *     (rolling counters), and the sessions table (which itself shows a
 *     skeleton / error-with-retry / "No sessions yet" empty / populated rows).
 *
 * To stay deterministic + parallel-safe across any of those states (and either
 * auth/flag posture), this spec asserts the always-rendered shell hard, then
 * branches tolerantly on the flag-gate vs management surface — mirroring the
 * env-tolerant pattern in site-mcp-server.spec.ts + webhooks.spec.ts.
 * Deterministic (locator waits only), parallel-safe (isolated authed context),
 * stable selectors (role / text / class).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

// Deterministic placeholder site id — the always-rendered shell mounts for any
// `:id`; the fetch outcome for this id is irrelevant to the shell assertions.
const SITE_ID = process.env.E2E_SITE_ID ?? 'e2e-site';

test.describe('ADMIN-30 — /admin/sites/:id/copilot Multimodal AI Site Copilot surface renders', () => {
  test('copilot shell, title, enable toggle + flag-gate / management surface render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/sites/${SITE_ID}/copilot`);

    // Always-rendered header band — the section shell mounts regardless of
    // fetch/flag state.
    await expect(
      page.locator('h2').filter({ hasText: /Multimodal AI Copilot/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const shell = page.locator('.copilot-shell').first();
    await expect(shell).toBeVisible({ timeout: 10_000 });

    // "Site Copilot" eyebrow renders in the always-rendered header.
    await expect(shell.getByText(/^Site Copilot$/i).first()).toBeVisible({ timeout: 10_000 });

    // The enable toggle (a checkbox carrying the "Copilot enabled/disabled"
    // aria-label) is part of the always-rendered header band — it mounts
    // before any fetch resolves.
    await expect(
      page.locator('input[type="checkbox"]').first(),
    ).toBeAttached({ timeout: 10_000 });

    // Branch on flag posture. When `GET /copilot/config` 404s the flag-gate
    // notice renders (links to /admin/feature-flags); otherwise the management
    // surface renders (stats row + sessions table). Either is a valid,
    // deterministic state — assert whichever is present without making either
    // a hard requirement.
    const flagGate = page.locator('.copilot-flag-gate').first();
    const sessionsTable = page.locator('.copilot-table').first();

    if (await flagGate.isVisible({ timeout: 4_000 }).catch(() => false)) {
      // Flag disabled — the honest gate notice references the feature flag.
      await expect(flagGate).toBeVisible();
      await expect(flagGate.getByText(/multimodal_copilot/i).first()).toBeVisible({ timeout: 4_000 });
    } else if (await sessionsTable.isVisible({ timeout: 4_000 }).catch(() => false)) {
      // Flag enabled — the management surface renders the sessions table.
      await expect(sessionsTable).toBeVisible();
      // The post-fetch body is exactly one of skeleton / error+retry / empty /
      // rows. Assert the empty-state or error-retry when present without
      // making either a hard requirement (loading skeleton is also valid).
      const emptyState = page.getByText(/No sessions yet/i).first();
      const loadError = page.locator('[data-testid="copilot-load-error"]').first();
      if (await loadError.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(page.locator('[data-testid="copilot-retry"]').first()).toBeVisible({ timeout: 2_000 });
      } else if (await emptyState.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(emptyState).toBeVisible();
      }
      // (else still loading / skeleton — the always-rendered shell above is the
      //  deterministic floor and has already been asserted.)
    }
    // (else neither resolved yet within the budget — the always-rendered shell
    //  is the deterministic floor and has already been asserted.)

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
