/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the REMAINING admin alias redirects.
 * mcp/ai-chat are covered by settings-tab-redirects.spec. This asserts the rest:
 * social/analytics, ai-logs, traces, seo, webhooks, dashboard — so every
 * advertised alias is proven to land on the right route (pairs with the
 * orphan-route build gate, see [[admin-advertised-route-orphans]]).
 *
 * (The /admin/media alias was removed together with the editor Media section.)
 *
 * A stale app.routes.ts edit is how these silently 404 (gotcha #6) — this spec
 * fails the moment one loses its redirect.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./settings-tab-redirects.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const NOT_FOUND = /this admin page doesn't exist|page does not exist/i;

/** from-path → expected resolved { pathname, query-substring? }. */
const QUERY_ALIASES: ReadonlyArray<{ from: string; pathname: string; query?: string }> = [
  { from: '/admin/social/analytics', pathname: '/admin/analytics', query: 'tab=social' },
  { from: '/admin/ai-logs', pathname: '/admin/logs', query: 'tab=traces' },
  { from: '/admin/traces', pathname: '/admin/logs', query: 'tab=traces' },
  { from: '/admin/seo', pathname: '/admin/site-features' },
  { from: '/admin/dashboard', pathname: '/admin' },
];

test.describe('Admin · remaining alias redirects (P0-ADMIN)', () => {
  for (const alias of QUERY_ALIASES) {
    test(`${alias.from} resolves to ${alias.pathname}${alias.query ? '?' + alias.query : ''}`, async ({
      page,
    }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.goto(alias.from, { waitUntil: 'domcontentloaded' });

      await page
        .waitForFunction((p) => location.pathname === p, alias.pathname, { timeout: 10000 })
        .catch(() => {});
      const u = new URL(page.url());
      expect(u.pathname, `${alias.from} must resolve to ${alias.pathname}`).toBe(alias.pathname);
      if (alias.query) {
        expect(u.search, `${alias.from} must carry ?${alias.query}`).toContain(alias.query);
      }
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(NOT_FOUND.test(body), `${alias.from} must not render the admin not-found page`).toBe(false);
    });
  }

  test('/admin/webhooks resolves to the Settings tab (not the not-found page)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/admin/webhooks', { waitUntil: 'domcontentloaded' });

    // Fragment (#webhooks) can't be read reliably from page.url(); assert the
    // pathname landed on Settings + it isn't the not-found page (mirrors mcp/ai-chat).
    await page
      .waitForFunction(() => location.pathname === '/admin/settings', undefined, { timeout: 10000 })
      .catch(() => {});
    expect(new URL(page.url()).pathname, '/admin/webhooks must resolve to Settings').toBe('/admin/settings');
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(NOT_FOUND.test(body), '/admin/webhooks must not render the admin not-found page').toBe(false);
  });
});
