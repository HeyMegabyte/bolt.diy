/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — REGRESSION for the P0.78 fix: the
 * `/admin/mcp` and `/admin/ai-chat` alias redirects (both were 404ing — the admin
 * not-found page — because their functional-redirect routes had been lost, leaving
 * only orphaned comments in app.routes.ts).
 *
 * MCP + AI Chat live as TABS inside Settings; the redirect must carry the URL
 * `#fragment` (a static `redirectTo` can't) so Settings opens the right tab
 * (Settings reads `route.snapshot.fragment`). This mirrors the media/traces/seo
 * aliases (see [[admin-verify-e2e-authoring-gotchas]] #6, admin-alias-and-editor-media.spec).
 *
 * Caught by the Browserbase visual sweep (`/admin/mcp` h1 = "This admin page
 * doesn't exist"), which `sections-visual` missed — its generic BROKEN-copy list
 * doesn't include the not-found phrase (gotcha #6). Fixed + verified LIVE as brian:
 * /admin/mcp now opens the MCP tab (real 2 connected / 31 available integrations).
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./admin-alias-and-editor-media.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const NOT_FOUND = /this admin page doesn't exist|page does not exist/i;

test.describe('Admin · /admin/mcp + /admin/ai-chat settings-tab redirects (P0-ADMIN)', () => {
  test('/admin/mcp redirects to the Settings MCP tab (not the not-found page)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/mcp', { waitUntil: 'domcontentloaded' });

    // The functional redirect resolves to /admin/settings (with the #mcp fragment).
    await page.waitForFunction(() => location.pathname === '/admin/settings', undefined, { timeout: 10000 }).catch(() => {});
    expect(new URL(page.url()).pathname, '/admin/mcp must resolve to Settings').toBe('/admin/settings');

    // The #mcp fragment opened the MCP tab — its integrations panel renders.
    await expect(page.getByText(/MCP integrations/i).first(), 'the MCP tab must be the active panel').toBeVisible({
      timeout: 10000,
    });
    // And it is NOT the admin not-found page (the bug this redirect fixes).
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(NOT_FOUND.test(body), '/admin/mcp must not render the admin not-found page').toBe(false);
  });

  test('/admin/ai-chat redirects to the Settings AI Chat tab (not the not-found page)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/ai-chat', { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => location.pathname === '/admin/settings', undefined, { timeout: 10000 }).catch(() => {});
    expect(new URL(page.url()).pathname, '/admin/ai-chat must resolve to Settings').toBe('/admin/settings');

    // The #ai-chat fragment opened the AI Chat tab — its panel subheader renders.
    await expect(
      page.getByText(/knowledge files for the AI chat widget/i).first(),
      'the AI Chat tab must be the active panel',
    ).toBeVisible({ timeout: 10000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(NOT_FOUND.test(body), '/admin/ai-chat must not render the admin not-found page').toBe(false);
  });
});
