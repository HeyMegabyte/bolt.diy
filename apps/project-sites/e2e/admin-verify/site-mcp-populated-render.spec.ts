/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — POPULATED-RENDER + XSS for the per-site MCP Server
 * section (`/admin/sites/:id/mcp-server`). Stubs the tokens list and the tools list POPULATED with
 * hostile rows (`<img onerror>` + unicode) and asserts each renders + the payload is inert — the
 * populated counterpart to `site-mcp-tools-empty-state` + `site-mcp-server-error-state`.
 * Both lists are `{{ }}`-interpolation (innerHTML-free); tokens key `tokens`, tools key `tools`.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./site-mcp-server-error-state.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const XSS = '<img src=x onerror="window.__xssHit=1">日本語 🎉';

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

test.describe('Admin · Site MCP Server populated-render + XSS (P0-ADMIN)', () => {
  test('tokens: a populated token list renders rows + a hostile label is inert', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let hadDialog = false;
    page.on('dialog', (d) => {
      hadDialog = true;
      d.dismiss().catch(() => {});
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const siteId = await firstSiteId(page);
    test.skip(!siteId, 'org has no site to drill into');

    await page.route('**/api/sites/*/mcp/tokens**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tokens: [
            { id: 't1', label: 'Cursor', last_used: '2026-07-30T10:00:00Z', created_at: '2026-07-01T09:00:00Z' },
            { id: 't2', label: XSS, last_used: null, created_at: '2026-07-02T09:00:00Z' },
          ],
        }),
      }),
    );
    await page.goto(`/admin/sites/${siteId}/mcp-server`, { waitUntil: 'domcontentloaded' });

    await expect(
      page.locator('[data-testid^="token-row-"]').first(),
      'the populated token rows render',
    ).toBeVisible({ timeout: 15000 });
    expect(await page.locator('[data-testid^="token-row-"]').count(), 'both token rows render').toBeGreaterThanOrEqual(2);
    expect(
      await page.evaluate(() => (window as unknown as { __xssHit?: number }).__xssHit ?? 0),
      'the hostile token label did not execute',
    ).toBe(0);
    expect(hadDialog, 'no alert dialog from the token label').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-mcp-tokens-populated.png' });
    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });

  test('tools: a populated tool list renders rows + a hostile description is inert', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let hadDialog = false;
    page.on('dialog', (d) => {
      hadDialog = true;
      d.dismiss().catch(() => {});
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const siteId = await firstSiteId(page);
    test.skip(!siteId, 'org has no site to drill into');

    await page.route('**/api/sites/*/mcp/tools**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tools: [
            { name: 'read_site_content', description: 'Retrieves site data', inputSchema: {}, requiresAuth: false },
            { name: 'write_site_content', description: XSS, inputSchema: {}, requiresAuth: true },
          ],
        }),
      }),
    );
    await page.goto(`/admin/sites/${siteId}/mcp-server`, { waitUntil: 'domcontentloaded' });

    await expect(
      page.locator('[data-testid^="tool-row-"]').first(),
      'the populated tool rows render',
    ).toBeVisible({ timeout: 15000 });
    expect(await page.locator('[data-testid^="tool-row-"]').count(), 'both tool rows render').toBeGreaterThanOrEqual(2);
    expect(
      await page.evaluate(() => (window as unknown as { __xssHit?: number }).__xssHit ?? 0),
      'the hostile tool description did not execute',
    ).toBe(0);
    expect(hadDialog, 'no alert dialog from the tool description').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/site-mcp-tools-populated.png' });
    expect(errors, `no console errors — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
