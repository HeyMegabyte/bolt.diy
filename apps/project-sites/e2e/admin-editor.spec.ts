/**
 * Admin Editor Section — bolt.diy iframe + bolt embed service verification.
 *
 * The editor is the core of the admin experience. The bolt.diy iframe
 * at editor.projectsites.dev is persisted across admin sub-routes
 * by BoltEmbedService. WebContainer cold-boot is ~30-60s.
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Editor Section', () => {
  test('/admin/editor redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/editor`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });

  test('/admin/welcome (legacy) redirects to sign-in when unauthenticated', async ({ page }) => {
    await page.goto(`${PROD_URL}/admin/welcome`);
    await page.waitForURL('**/signin**', { timeout: 10000 });
    await expect(page.locator('[data-testid="sign-in-page"]')).toBeVisible();
  });

  test('editor.projectsites.dev is reachable', async ({ request }) => {
    const res = await request.get('https://editor.projectsites.dev');
    expect([200, 301, 302]).toContain(res.status());
  });
});
