/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the per-site MCP
 * tokens fetch degrades to a calm error card + Retry, never a crash — and only the tokens card
 * fails (tools stays live), proving the two error surfaces are independent.
 * Extends the error-injection pattern to `/admin/sites/:id/mcp-server` (a site-detail subroute).
 *
 * `site-mcp-server.component.ts`: two `<app-error-card>`s — `title="Couldn't load tokens"
 * (retry)="loadTokens()"` and `title="Couldn't load tools" (retry)="loadTools()"` (neither has a
 * data-testid → matched by title on the shared inner `[data-testid="error-card"]`). `ngOnInit`
 * fires loadTokens/loadTools/loadUsage → AUTO-LOAD. This 500s ONLY `/mcp/tokens`, so the tokens
 * card renders while tools stays real. Site-scoped, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./site-mcp-server-interactions.spec.ts} — the happy-path CRUD contract.
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|status of 500|Access is denied for this document|localStorage/i.test(m.text())
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

test.describe('Admin · Site MCP Server error-state resilience (P0-ADMIN)', () => {
  test('a 500 on /mcp/tokens shows the tokens error card + Retry (tools stays live, no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/mcp\/tokens(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const siteId = await firstSiteId(page);
    test.skip(!siteId, 'org has no site to drill into');

    await page.route('**/api/sites/*/mcp/tokens**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto(`/admin/sites/${siteId}/mcp-server`, { waitUntil: 'domcontentloaded' });

    // The tokens card is an app-error-card with no section testid → scope by its title on the
    // shared inner error-card, so a sibling error surface can't satisfy the assertion.
    const card = page.locator('[data-testid="error-card"]').filter({ hasText: /couldn.t load tokens/i });
    await expect(card, 'the tokens error card renders on a tokens load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the tokens request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-mcp-server-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
