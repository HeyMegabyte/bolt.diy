/**
 * ADMIN-31 — /admin/sites/:id/dna Site DNA Taste Graph surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The Site DNA panel ({@link AdminSiteDnaComponent}, mounted at
 * `/admin/sites/:id/dna`) ALWAYS renders its `.dna-shell` header (eyebrow
 * "Site DNA" + "Taste Graph" h2 + a feature-flag chip linking to
 * `/admin/feature-flags`). The body is flag-gated (`site_dna_taste_graph`):
 * when OFF, a `dna-flag-gate` prompt renders; when ON, the `dna-stats` grid
 * (Total / Accepted / Rejected / Edited / Learned, all via
 * `<app-rolling-counter>`) + the `dna-taste-pulse` distribution bar render.
 *
 * To stay deterministic + parallel-safe across either flag state, this spec
 * asserts the always-rendered header hard, then branches on flag-gate vs the
 * stats/pulse surface — mirroring the env-tolerant pattern in
 * webhooks.spec.ts / site-mcp-server.spec.ts. Site-scoped `:id` route uses the
 * `E2E_SITE_ID ?? 'e2e-site'` placeholder pattern from the sibling specs.
 * Deterministic (locator waits only), parallel-safe (isolated authed context),
 * stable selectors (data-testid / role / text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';
const SITE_ID = process.env.E2E_SITE_ID ?? 'e2e-site';

test.describe('ADMIN-31 — /admin/sites/:id/dna Site DNA Taste Graph surface renders', () => {
  test('site-dna header + flag-gate / stats+pulse render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/sites/${SITE_ID}/dna`);

    // Always-rendered shell header — mounts regardless of flag/site state.
    await expect(
      page.locator('h2').filter({ hasText: /Taste Graph/i }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.dna-eyebrow').filter({ hasText: /Site DNA/i }).first()).toBeVisible();

    // Branch on flag state. Flag OFF → the dna-flag-gate prompt. Flag ON → the
    // stats grid + Taste Pulse distribution bar. Either is a valid state.
    const flagGate = page.locator('[data-testid="dna-flag-gate"]').first();
    if (await flagGate.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await expect(flagGate).toBeVisible();
      // The gate links to Feature Flags to enable the feature.
      await expect(page.getByRole('link', { name: /Enable in Feature Flags/i }).first()).toBeVisible();
    } else {
      // Flag enabled: the stats grid + Taste Pulse render.
      await expect(page.locator('[data-testid="dna-stats"]').first()).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('[data-testid="dna-taste-pulse"]').first()).toBeVisible({ timeout: 5_000 });
    }

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
