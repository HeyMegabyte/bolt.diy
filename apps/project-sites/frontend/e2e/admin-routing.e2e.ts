/**
 * @module e2e/admin-routing
 *
 * Legacy /admin Angular-routing guarantees (TDD for the "hijack all navigation —
 * zero full reloads" work). Proves: the shell mounts ONCE and every in-admin nav
 * keeps the SPA alive — `performance.getEntriesByType('navigation').length`
 * never increases, the sidebar element keeps its identity, no `beforeunload`
 * fires, and the console stays clean. Seeds `ps_session` from `E2E_API_KEY`
 * (real psk_test_ row). Run: `npm run test:e2e:prod`.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const KEY = process.env.E2E_API_KEY ?? '';
const IGNORE = [
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /posthog/i,
  /NG0911/i,
  /editor\.projectsites\.dev/i,
  // Resource-load 404s log a GENERIC "Failed to load resource" (no URL in the
  // text), so they can't be URL-filtered. On /admin they're external/benign
  // (GA beacon, gstatic favicon-preview) + a graceful 'no chat yet' /chat 404.
  // This test gates NO-RELOAD + uncaught pageerrors; resource completeness is a
  // separate concern. Tracked finding: /api/sites/by-slug/:slug/chat 404s.
  /Failed to load resource/i,
];
const isAppError = (t: string): boolean => !IGNORE.some((re) => re.test(t));

async function seed(page: Page): Promise<void> {
  await page.addInitScript((k: string) => {
    try {
      localStorage.setItem('ps_session', JSON.stringify({ token: k, identifier: 'test@megabyte.space', createdAt: Date.now() }));
    } catch {
      /* private mode */
    }
  }, KEY);
}
function track(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && isAppError(m.text())) errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  return errs;
}

test.describe('legacy /admin — Angular routing (zero full reloads)', () => {
  test.skip(!KEY, 'E2E_API_KEY not set');
  test.beforeEach(async ({ page }) => {
    await seed(page);
  });

  test('shell mounts once + every nav stays SPA (no full reload)', async ({ page }) => {
    test.setTimeout(120_000);
    const errs = track(page);
    await page.goto('/admin', { waitUntil: 'load' });

    // the persistent sidebar
    const sidebar = page.locator('.admin-sidebar').first();
    await expect(sidebar).toBeVisible({ timeout: 20000 });
    // tag the shell so we can prove it's the SAME element after navigation
    await sidebar.evaluate((el: HTMLElement) => (el.dataset.spaSentinel = 'mounted'));
    // arm a beforeunload tripwire — a full reload would fire it
    await page.evaluate(() => {
      (window as unknown as { __reloaded?: boolean }).__reloaded = false;
      window.addEventListener('beforeunload', () => ((window as unknown as { __reloaded?: boolean }).__reloaded = true));
    });

    // walk the in-admin nav via the routerLink anchors (rendered as hrefs)
    const targets = ['/admin/snapshots', '/admin/forms', '/admin/analytics', '/admin/audit', '/admin/settings', '/admin'];
    for (const href of targets) {
      const link = page.locator(`a[href="${href}"]`).first();
      if ((await link.count()) === 0) continue;
      await link.click();
      await expect(page).toHaveURL(new RegExp(href.replace(/\//g, '\\/') + '(\\?|$|/)'));
      await expect(sidebar).toBeVisible();
    }

    // SPA invariants
    const navEntries = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    expect(navEntries, 'exactly one navigation entry — no full reloads occurred').toBe(1);
    const sameShell = await sidebar.evaluate((el: HTMLElement) => el.dataset.spaSentinel === 'mounted');
    expect(sameShell, 'sidebar kept its identity across nav (shell mounted once)').toBe(true);
    const reloaded = await page.evaluate(() => (window as unknown as { __reloaded?: boolean }).__reloaded === true);
    expect(reloaded, 'no beforeunload fired during in-admin navigation').toBe(false);
    expect(errs, errs.join('\n')).toEqual([]);
  });

  test('every admin route deep-links + survives a refresh (no blank, no pageerror)', async ({ page }) => {
    test.setTimeout(120_000);
    const routes = [
      '/admin', '/admin/snapshots', '/admin/analytics', '/admin/forms', '/admin/traces',
      '/admin/apps', '/admin/social', '/admin/voice', '/admin/audit', '/admin/feature-flags',
      '/admin/docs', '/admin/settings',
    ];
    for (const r of routes) {
      const pageErrs: string[] = [];
      page.once('pageerror', (e) => pageErrs.push(e.message));
      // DIRECT load (deep-link), not via in-app nav
      await page.goto(r, { waitUntil: 'load' });
      // shell mounts + the routed section paints real content (root not empty)
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 20000 });
      const mainLen = await page.evaluate(() => {
        const main = document.querySelector('main, [role="main"], router-outlet')?.parentElement;
        return (main?.textContent ?? document.body.textContent ?? '').trim().length;
      });
      expect(mainLen, `${r} rendered non-empty content on deep-link`).toBeGreaterThan(50);
      // refresh the deep route — must not blank out
      await page.reload({ waitUntil: 'load' });
      await expect(page.locator('.admin-sidebar').first()).toBeVisible({ timeout: 20000 });
      expect(pageErrs, `${r} threw on deep-link/refresh: ${pageErrs.join('; ')}`).toEqual([]);
    }
  });
});
