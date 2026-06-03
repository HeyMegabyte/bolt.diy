/**
 * ADMIN-30 — /admin/sites/:id Site Detail split-view surface renders
 *
 * Per [[e2e-tdd-organization]]: goto('/') → authedPage → navigate to sub-route.
 *
 * The site-detail section ({@link AdminSiteDetailComponent}, mounted at
 * `/admin/sites/:id`) ALWAYS renders its shell regardless of API / fetch state:
 * the `[data-testid="site-detail"]` container, the site header (h1 title +
 * `.projectsites.dev` slug subtitle), and the four-tab `role="tablist"` nav with
 * `role="tab"` buttons — Logs / Snapshots / SQL / Integrations. These mount
 * synchronously from the template before `GET /api/sites/:id`, `/logs/tail`,
 * `/snapshots`, and `/integrations` resolve (each handler `catchError`s to an
 * empty/fallback shape, so the shell never depends on a live fetch).
 *
 * The Logs tab is the default (`tab()` starts at `'logs'`) — its panel
 * (`[data-testid="site-logs-panel"]`) + the log tail (`[data-testid="site-logs-tail"]`)
 * render immediately. Switching tabs swaps which `@if`-gated panel mounts.
 *
 * To stay deterministic + parallel-safe across any fetch outcome (empty logs,
 * empty snapshots, fallback integration catalog), this spec asserts the
 * always-rendered shell + the four tabs hard, confirms the default Logs panel,
 * then clicks each remaining tab and asserts its panel mounts — mirroring the
 * env-tolerant pattern in site-mcp-server.spec.ts + webhooks.spec.ts.
 * Deterministic (locator waits only), parallel-safe (isolated authed context),
 * stable selectors (data-testid / role / text).
 */

import { test, expect } from '../fixtures.js';

const BASE = process.env.BASE_URL ?? process.env.PROD_URL ?? 'http://localhost:8787';

// Deterministic placeholder site id — the always-rendered shell mounts for any
// `:id`; the fetch outcome for this id is irrelevant to the shell assertions.
const SITE_ID = process.env.E2E_SITE_ID ?? 'e2e-site';

test.describe('ADMIN-30 — /admin/sites/:id Site Detail split-view surface renders', () => {
  test('site-detail shell, header, tabs + per-tab panels render', async ({ authedPage: page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE}/admin/sites/${SITE_ID}`);

    // Always-rendered shell — the section mounts regardless of fetch state.
    const shell = page.locator('[data-testid="site-detail"]');
    await expect(shell).toBeVisible({ timeout: 15_000 });

    // Site header: h1 title (falls back to "Site" before the fetch resolves) +
    // the `.projectsites.dev` slug subtitle line.
    await expect(shell.locator('h1.site-detail__title').first()).toBeVisible({ timeout: 10_000 });
    await expect(shell.getByText(/\.projectsites\.dev/i).first()).toBeVisible({ timeout: 10_000 });

    // Four-tab nav: the tablist + its four role="tab" buttons all mount synchronously.
    const tablist = shell.locator('[role="tablist"]').first();
    await expect(tablist).toBeVisible({ timeout: 10_000 });
    await expect(tablist.locator('[role="tab"]')).toHaveCount(4, { timeout: 10_000 });
    for (const label of ['Logs', 'Snapshots', 'SQL', 'Integrations']) {
      await expect(
        tablist.locator('[role="tab"]').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first(),
      ).toBeVisible({ timeout: 10_000 });
    }

    // Logs is the default tab — its panel + the log tail render immediately.
    await expect(page.locator('[data-testid="site-logs-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="site-logs-tail"]')).toBeVisible({ timeout: 10_000 });

    // Switch to Snapshots → its panel mounts (list or empty-state, either valid).
    await tablist.locator('[role="tab"]').filter({ hasText: /^Snapshots$/i }).first().click();
    await expect(page.locator('[data-testid="site-snapshots-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="site-snapshots-list"]')).toBeVisible({ timeout: 10_000 });

    // Switch to SQL → the read-only D1 console panel + its editor mount.
    await tablist.locator('[role="tab"]').filter({ hasText: /^SQL$/i }).first().click();
    await expect(page.locator('[data-testid="site-sql-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="sql-editor"]')).toBeVisible({ timeout: 10_000 });

    // Switch to Integrations → the MCP provider surface mounts (fallback catalog
    // renders even when the integrations fetch errors, so the list is present).
    await tablist.locator('[role="tab"]').filter({ hasText: /^Integrations$/i }).first().click();
    await expect(page.locator('[data-testid="site-integrations-panel"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="mcp-provider-list"]')).toBeVisible({ timeout: 10_000 });

    expect(
      consoleErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR_BLOCKED')),
    ).toHaveLength(0);
  });
});
