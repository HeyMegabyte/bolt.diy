import { test, expect, type Page } from '@playwright/test';

// Authed prod check: the cyan primary sidebar item must label the index route
// (/admin) "Dashboard" — it renders the AI Dashboard, NOT the editor (which
// moved to /admin/editor). It used to mislabel as "Editor", contradicting the
// breadcrumb / palette / g-chord (all of which call /admin "Dashboard").
const KEY = process.env.E2E_API_KEY ?? '';
async function seed(p: Page) {
  await p.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'brian@megabyte.space', createdAt: Date.now() }));
      localStorage.setItem('ps_feedback_dismissed', 'true');
    } catch { /* */ }
  }, KEY);
}

test('the cyan primary sidebar item links to /admin and is labeled "Dashboard" (not "Editor")', async ({ page }) => {
  await seed(page);
  await page.goto('https://projectsites.dev/admin/sites', { waitUntil: 'domcontentloaded' });
  const primary = page.locator('a.nav-item').filter({ has: page.locator('svg') }).first();
  // The item that routerLinks to exactly /admin (the primary/cyan item).
  const adminItem = page.locator('a.nav-item[href="/admin"]').first();
  await expect(adminItem).toBeVisible();
  await expect(adminItem).toHaveText(/Dashboard/);
  await expect(adminItem).not.toHaveText(/Editor/);
  // The bolt editor has its OWN distinct sidebar entry → /admin/editor.
  await expect(page.locator('a.nav-item[href="/admin/editor"]')).toHaveCount(1);
  void primary;
});
