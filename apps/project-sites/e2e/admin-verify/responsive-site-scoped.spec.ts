/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the SITE-SCOPED sections (distinct layouts:
 * snapshot version-history, form-submission table, settings tabs, domain hostname
 * table, feature catalog, social composer) render WITHOUT horizontal overflow across
 * the tablet→wide breakpoints. Completes the mandate's "6 breakpoints" requirement for
 * the site-scoped surfaces the org-level responsive specs don't cover.
 *
 * Breakpoints: 768/1024/1280/1920 — the sidebar site-switcher (`selectFirstSite`) is
 * only reachable at ≥768 (below that it's behind the mobile hamburger; those sections'
 * shared card/table components are already mobile-verified via the org-level specs).
 *
 * NON-MUTATING: navigation + `selectFirstSite` + layout measurement only.
 *
 * @see {@link ./responsive-breakpoints.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';
import { selectFirstSite } from '../helpers/site-context.js';

const BREAKPOINTS = [
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide', width: 1920, height: 1080 },
];
const SECTIONS = ['/admin/snapshots', '/admin/forms', '/admin/settings', '/admin/domains', '/admin/site-features', '/admin/social'];

const measure = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return {
      scrollW: el.scrollWidth,
      innerW: window.innerWidth,
      crashed: /ran into a problem|something went wrong/i.test(document.body.innerText || ''),
    };
  });

test.describe('Admin · site-scoped responsive — no horizontal overflow (P0-ADMIN)', () => {
  for (const bp of BREAKPOINTS) {
    for (const path of SECTIONS) {
      test(`${path} has no horizontal overflow at ${bp.name} (${bp.width}px)`, async ({ page }) => {
        test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await setupRealDataPage(page, { passthrough: /\/api\// });
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        test.skip(!(await selectFirstSite(page).catch(() => false)), 'no site to scope the section to');
        await page.waitForTimeout(1500);

        const m = await measure(page);
        expect(m.crashed, `${path} must not crash at ${bp.name}`).toBe(false);
        expect(
          m.scrollW,
          `${path} horizontal overflow at ${bp.width}px (document scrollWidth ${m.scrollW} vs viewport ${m.innerW})`,
        ).toBeLessThanOrEqual(m.innerW + 2);
      });
    }
  }
});
