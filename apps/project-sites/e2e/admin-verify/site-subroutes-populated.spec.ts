/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the site-detail SUB-ROUTES all render
 * clean in a REAL browser for a real site.
 *
 * `/admin/sites/:id/*` sub-routes read the siteId from the ActivatedRoute param
 * (not an @Input), so they render standalone. This walks the first site's
 * sub-routes and asserts, against LIVE prod (authed real session):
 *  - each renders (real `<main>` content, not an admin-404 shell),
 *  - zero console errors + zero failed (4xx/5xx) requests while it loads.
 *
 * Verified green for brian@megabyte.space via the Browserbase sweep
 * (site / branches / mcp-server / copilot / dna — all 0-error, populated or
 * honest-empty-with-affordance); this locks that in for CI (E2E_API_KEY org).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Site-detail sub-routes reachable from a site id (all param-driven, no data-seed needed to render). */
const SUBROUTES = ['', '/branches', '/mcp-server', '/copilot', '/dna'] as const;

test.describe('Admin · site-detail sub-routes render clean (P0-ADMIN)', () => {
  test('every /admin/sites/:id/* sub-route renders with 0 console errors + 0 failed requests', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const token = process.env.E2E_API_KEY!;

    const consoleErrors: string[] = [];
    const failed: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('response', (res) => {
      if (res.status() >= 400 && !res.url().includes('google-analytics') && !res.url().includes('/g/collect') && res.url().includes('/api/')) {
        failed.push(`${res.status()} ${res.url().replace('https://projectsites.dev', '').slice(0, 70)}`);
      }
    });

    // Let real /api reads through (authed → real data); stub nothing critical.
    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const siteId = await page.evaluate(async (bearer) => {
      const res = await fetch('/api/sites', { headers: { Authorization: `Bearer ${bearer}` } });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const list = (j.data || j.sites || j.items || []) as Array<{ id?: string }>;
      return list[0]?.id ?? null;
    }, token);
    test.skip(!siteId, 'org has no site to drill into');

    for (const suffix of SUBROUTES) {
      const path = `/admin/sites/${siteId}${suffix}`;
      failed.length = 0;
      consoleErrors.length = 0;
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      // Give the section's async fetches time to resolve.
      await page.waitForTimeout(2500);

      const info = await page.evaluate(() => ({
        isAdmin404: /doesn.t exist/i.test(document.body.innerText || ''),
        crashed: /ran into a problem/i.test(document.body.innerText || ''),
        mainLen: (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length,
      }));

      expect(info.isAdmin404, `${path} must not be an admin-404`).toBe(false);
      expect(info.crashed, `${path} must not hit the error boundary`).toBe(false);
      expect(info.mainLen, `${path} must render real content`).toBeGreaterThan(80);
      expect(failed, `${path} must load with 0 failed API requests — saw ${failed.join(' | ')}`).toEqual([]);
      expect(consoleErrors, `${path} must load with 0 console errors — saw ${consoleErrors.join(' | ')}`).toEqual([]);

      await page.screenshot({ path: `e2e/screenshots/admin-verify/site-sub${suffix.replace(/\//g, '-') || '-detail'}.png` });
    }
  });
});
