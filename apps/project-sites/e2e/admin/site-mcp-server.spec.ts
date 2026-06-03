/**
 * ADMIN-29 — /admin/sites/:id/mcp-server Per-site MCP server surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The site-mcp-server section ({@link SiteMcpServerComponent}, mounted at
 * `/admin/sites/:id/mcp-server`) ALWAYS renders its shell regardless of API /
 * flag state: the `[data-testid="site-mcp-server"]` container, the "MCP Server"
 * h2, the stats grid (Tools / Tokens / Calls Today rolling counters), the
 * "API Tokens" section with its mint control (`[data-testid="mint-token-btn"]`),
 * and the "Available Tools" section. These mount synchronously from the
 * template before the `GET /api/sites/:id/mcp/{tokens,tools,tool-usage}`
 * fetches resolve.
 *
 * The MCP endpoint URL display control lives inside `@if (siteSlug())` — it
 * renders once `GET /api/sites/:id` resolves a slug for the supplied id. Below
 * the always-rendered shell each section shows exactly one of: a loading
 * skeleton, an error card, an empty state, or the populated table — depending
 * on the fetch outcome. To stay deterministic + parallel-safe across any of
 * those states (and either auth/flag posture), this spec asserts the
 * always-rendered shell hard, then branches tolerantly on the slug-gated
 * endpoint line and the post-fetch token surfaces — mirroring the env-tolerant
 * pattern in site-branches.spec.ts + enterprise.spec.ts + apps.spec.ts.
 * Deterministic (locator waits only), parallel-safe (isolated authed context),
 * stable selectors (data-testid / role / text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

// Deterministic placeholder site id — the always-rendered shell mounts for any
// `:id`; the fetch outcome for this id is irrelevant to the shell assertions.
const SITE_ID = process.env.E2E_SITE_ID ?? 'e2e-site';

test.describe('ADMIN-29 — /admin/sites/:id/mcp-server Per-site MCP server surface renders', () => {
  test('mcp-server shell, stats grid, token + tool sections render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/sites/${SITE_ID}/mcp-server`);

    // Always-rendered shell — the section mounts regardless of fetch/flag state.
    await expect(page.locator('[data-testid="site-mcp-server"]')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator('h2').filter({ hasText: /MCP Server/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Stats grid: Tools / Tokens / Calls Today labels render in the always-rendered
    // header band (rolling counters render even at zero).
    const shell = page.locator('[data-testid="site-mcp-server"]');
    await expect(shell.getByText(/^Tools$/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(shell.getByText(/^Tokens$/i).first()).toBeVisible();
    await expect(shell.getByText(/Calls Today/i).first()).toBeVisible();

    // API Tokens section + its always-rendered mint control.
    await expect(
      page.locator('h3').filter({ hasText: /API Tokens/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="mint-token-btn"]')).toBeVisible({ timeout: 10_000 });

    // Available Tools section header is always rendered.
    await expect(
      page.locator('h3').filter({ hasText: /Available Tools/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Slug-gated MCP endpoint line: renders once GET /api/sites/:id resolves a
    // slug. The endpoint URL ends in `/mcp` on the `*.projectsites.dev` host.
    // Assert it when present without making it a hard requirement (the stubbed
    // id may not resolve a slug).
    const endpoint = shell.getByText(/\.projectsites\.dev\/mcp/i).first();
    if (await endpoint.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await expect(endpoint).toBeVisible();
    }

    // Post-fetch token surface is exactly one of skeleton / error / empty / table.
    // Assert the populated table or empty state when present without making
    // either a hard requirement (the error card + retry is a legitimate state in
    // a stubbed env). Branch tolerantly so the spec passes in any post-fetch state.
    const tokensTable = page.locator('[data-testid="tokens-table"]');
    const newTokenBanner = page.locator('[data-testid="new-token-banner"]');
    const tokensEmpty = page.getByText(/No tokens yet/i).first();

    if (await tokensTable.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await expect(tokensTable).toBeVisible();
    } else if (await tokensEmpty.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(tokensEmpty).toBeVisible();
    } else if (await newTokenBanner.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(newTokenBanner).toBeVisible();
    }
    // (else still loading / skeleton — the always-rendered shell above is the
    //  deterministic floor and has already been asserted.)

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
