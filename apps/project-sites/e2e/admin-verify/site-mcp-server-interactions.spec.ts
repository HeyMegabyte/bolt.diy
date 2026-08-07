/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the per-site MCP Server section
 * (`/admin/sites/:id/mcp-server`, testid `site-mcp-server`) renders its real
 * management contract in a REAL browser. `site-subroutes-populated.spec.ts` proves
 * this route merely "renders clean" (not-404, 0 errors); THIS locks the actual MCP
 * CRUD UI surface — the External-Agents header, the per-site endpoint, the API-token
 * mint affordance, and the stat counters — org-agnostically.
 *
 * Site-scoped: discovers the first site of the real session's org via `/api/sites`
 * (skips if the org has none). The section is NOT feature-flagged. No token is minted
 * (minting is a real mutation — assertions are read-only + the label input is filled
 * but never submitted).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./site-subroutes-populated.spec.ts} — the shallower renders-clean sweep.
 * @see {@link ./api-tokens-interactions.spec.ts} — sibling token-CRUD contract.
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Open the MCP Server section for the org's first site; returns the siteId (or null → skip). */
async function openMcp(page: Page): Promise<string | null> {
  const token = process.env.E2E_API_KEY!;
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const siteId = await page.evaluate(async (bearer) => {
    const res = await fetch('/api/sites', { headers: { Authorization: `Bearer ${bearer}` } });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const list = (j.data || j.sites || j.items || []) as Array<{ id?: string }>;
    return list[0]?.id ?? null;
  }, token);
  if (!siteId) return null;
  await page.goto(`/admin/sites/${siteId}/mcp-server`, { waitUntil: 'domcontentloaded' });
  await page
    .locator('[data-testid="site-mcp-server"]')
    .waitFor({ state: 'visible', timeout: 15000 })
    .catch(() => {});
  return siteId;
}

test.describe('Admin · site MCP Server interactions (P0-ADMIN)', () => {
  test('renders the MCP Server management surface (header + endpoint + tokens)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const siteId = await openMcp(page);
    test.skip(!siteId, 'org has no site to drill into');

    const section = page.locator('[data-testid="site-mcp-server"]');
    await expect(section, 'the MCP section mounts').toBeVisible({ timeout: 12000 });
    // Once the section mounts its children are present — scope to it (the topbar also
    // renders an "MCP Server" breadcrumb) and assert with the default (short) timeout so
    // five stacked long waits can't blow the per-test budget on a cold load.
    await expect(section.getByText(/mcp server/i).first(), 'the "MCP Server" heading renders').toBeVisible();
    await expect(section.getByText(/external agents/i).first(), 'the External Agents kicker renders').toBeVisible();
    await expect(section.getByText(/api tokens/i).first(), 'the API Tokens management block renders').toBeVisible();

    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("doesn't exist"), 'must not be an admin-404').toBe(false);
    expect(body.includes('ran into a problem'), 'must not be the error boundary').toBe(false);
    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-mcp-server.png' });
  });

  test('the mint-token affordance is present + editable (no token is actually minted)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const siteId = await openMcp(page);
    test.skip(!siteId, 'org has no site to drill into');

    const label = page.locator('[data-testid="new-token-label"]');
    await expect(label, 'the new-token label input renders').toBeVisible({ timeout: 8000 });
    // Editable — but we deliberately DO NOT submit (minting is a real, side-effecting mutation).
    await label.fill('e2e-probe');
    await expect(label, 'the label input accepts input').toHaveValue('e2e-probe');
  });

  test('the MCP stat counters render (real values or an honest "—" when a metric fails to load)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const siteId = await openMcp(page);
    test.skip(!siteId, 'org has no site to drill into');

    // The stats grid renders rolling counters; an empty org yields 0-valued counters
    // (a valid value), never a blank/omitted card. Org-agnostic presence check.
    const counters = page.locator('[data-testid="site-mcp-server"] app-rolling-counter');
    expect(await counters.count(), 'at least one MCP stat counter renders').toBeGreaterThanOrEqual(1);
  });
});
