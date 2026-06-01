/**
 * @module e2e/admin-console-hygiene
 *
 * Regression guard for admin console-hygiene fixes that `admin-functional.e2e.ts`
 * cannot catch (it ignores generic `Failed to load resource` 404s, so a
 * favicon/resource 404 slips its net).
 *
 *   - #136 the admin must NOT request a Google S2 favicon for generated
 *     `*.projectsites.dev` subdomains (Google doesn't crawl them → 404 logged on
 *     every admin load + monogram-fallback-anyway). siteFaviconUrl() returns ''
 *     for those hosts → the monogram renders with no network request.
 *
 * Seeds `ps_session` from `E2E_API_KEY`. Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* private mode */ }
  }, KEY);
}

test.describe('admin — console hygiene', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.describe.configure({ retries: 2 });

  test('no Google S2 favicon request for *.projectsites.dev sites (#136)', async ({ page }) => {
    test.setTimeout(60000);
    const faviconReqs: string[] = [];
    page.on('request', (r) => {
      if (/google\.com\/s2\/favicons/i.test(r.url())) faviconReqs.push(r.url());
    });

    await seed(page);
    await page.goto('/admin', { waitUntil: 'load' });
    // The sidebar + topbar (which render the site favicon/monogram) are present.
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    // Visit a section that lists multiple *.projectsites.dev sites (each would
    // have requested a favicon under the old code).
    await page.goto('/admin/sites', { waitUntil: 'load' });
    await page.waitForTimeout(1500);

    expect(
      faviconReqs,
      `admin requested Google S2 favicons (should resolve to the monogram tile instead):\n${faviconReqs.join('\n')}`,
    ).toEqual([]);
  });
});
