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

  test('/admin/feature-flags does NOT fire the super-admin endpoint for non-super-admins (no 401)', async ({
    page,
  }) => {
    test.setTimeout(60000);
    // The override-merge GET /api/super-admin/feature-flags 401s for non-super
    // admins; the browser logs that 401 uncatchably. The fix gates the fetch on
    // the isSuperAdmin() signal (from /api/auth/me), so a non-super-admin must
    // never trigger the request. The test account is a non-super-admin.
    const superAdminReqs: string[] = [];
    const superAdmin401s: number[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/super-admin/feature-flags')) superAdminReqs.push(r.url());
    });
    page.on('response', (r) => {
      if (r.url().includes('/api/super-admin/feature-flags') && r.status() === 401) {
        superAdmin401s.push(r.status());
      }
    });

    await seed(page);
    await page.goto('/admin/feature-flags', { waitUntil: 'load' });
    // Registry still renders from the public GET /api/feature-flags.
    await expect(page.locator('.ff-card').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    expect(
      superAdminReqs,
      `non-super-admin must not fire the super-admin override endpoint:\n${superAdminReqs.join('\n')}`,
    ).toEqual([]);
    expect(superAdmin401s, 'no 401 from the super-admin endpoint may be logged').toEqual([]);
  });

  test('bolt chat import does NOT 404 on our origin (graceful empty-state)', async ({ page }) => {
    test.setTimeout(60000);
    // The persistent bolt iframe auto-imports `/api/sites/by-slug/:slug/chat`.
    // Sites that are `published` in D1 but missing their R2 manifest used to 404
    // here, logging an un-suppressable "Failed to load resource: 404" on
    // projectsites.dev for every admin route. The worker now returns 200 with an
    // empty bolt chat, so no chat fetch on our origin may 404.
    const chat404s: string[] = [];
    page.on('response', (r) => {
      if (/\/api\/sites\/by-slug\/[^/]+\/chat/i.test(r.url()) && r.status() === 404) {
        chat404s.push(`${r.status()} ${r.url()}`);
      }
    });

    await seed(page);
    await page.goto('/admin', { waitUntil: 'load' });
    await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 30000 });
    // The editor route forces the iframe visible + triggers the chat import.
    await page.goto('/admin/editor', { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    expect(
      chat404s,
      `the chat-import endpoint must degrade to 200 empty, never 404:\n${chat404s.join('\n')}`,
    ).toEqual([]);
  });
});
