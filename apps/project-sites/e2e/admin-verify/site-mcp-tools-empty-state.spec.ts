/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: the per-site MCP Server section
 * renders an honest "No MCP tools available yet" state when the tools registry is empty — not a
 * crash. Complements `site-mcp-server-error-state.spec.ts` (500 → error card) + the interactions
 * spec: together they cover the tools surface in every state.
 *
 * Injection: `/api/sites/:id/mcp/tools` → `{tools:[]}` (the FE reads the `tools` key). `site-mcp-
 * server.component.ts`: `@if (tools().length === 0)` → `data-testid="mcp-tools-empty"`. Site-detail
 * subroute — the siteId is resolved from `/api/sites`. Auto-load on `ngOnInit`, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./site-mcp-server-error-state.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

async function firstSiteId(page: Page): Promise<string | null> {
  return page.evaluate(async (bearer) => {
    const res = await fetch('/api/sites', { headers: { Authorization: `Bearer ${bearer}` } });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const list = (j.data || j.sites || j.items || []) as Array<{ id?: string }>;
    return list[0]?.id ?? null;
  }, process.env.E2E_API_KEY!);
}

test.describe('Admin · Site MCP Tools empty-state honesty (P0-ADMIN)', () => {
  test('an empty tools registry renders the honest "No MCP tools" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const siteId = await firstSiteId(page);
    test.skip(!siteId, 'org has no site to drill into');

    await page.route('**/api/sites/*/mcp/tools**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"tools":[]}' }),
    );
    await page.goto(`/admin/sites/${siteId}/mcp-server`, { waitUntil: 'domcontentloaded' });

    const empty = page.locator('[data-testid="mcp-tools-empty"]');
    await expect(empty, 'the MCP-tools empty state renders on an empty registry').toBeVisible({ timeout: 15000 });
    await expect(empty, 'the copy is honest').toContainText(/no mcp tools/i);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty registry must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-mcp-tools-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
