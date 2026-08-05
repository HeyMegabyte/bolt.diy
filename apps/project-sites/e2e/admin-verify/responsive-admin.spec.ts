/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the admin shell + key sections render at
 * MOBILE (375) and TABLET (768) breakpoints WITHOUT horizontal overflow (no element
 * breaking out of the viewport) and without a crash. The prod config runs a single
 * Desktop viewport, so this covers the mandate's "no layout break at 6 breakpoints"
 * dimension that the interaction/value-domain specs don't.
 *
 * NON-MUTATING: pure navigation + layout measurement. A document `scrollWidth` wider
 * than the viewport is a real responsive bug (an in-page overflow-x container that
 * clips its own content does NOT widen the document — so this catches genuine breaks).
 *
 * @see {@link ./admin-nav-shell.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
];
// Org-level, reliably-populated sections (dashboard hub, apps catalog, API docs).
const SECTIONS = ['/admin', '/admin/apps', '/admin/docs'];

const measure = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return {
      scrollW: el.scrollWidth,
      innerW: window.innerWidth,
      crashed: /ran into a problem|something went wrong/i.test(document.body.innerText || ''),
      len: (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length,
    };
  });

test.describe('Admin · responsive rendering — no horizontal overflow (P0-ADMIN)', () => {
  for (const vp of VIEWPORTS) {
    for (const path of SECTIONS) {
      test(`${path} renders cleanly at ${vp.name} (${vp.width}px) — no horizontal overflow`, async ({ page }) => {
        test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await setupRealDataPage(page, { passthrough: /\/api\// });
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page
          .waitForFunction(
            () => (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length > 40,
            undefined,
            { timeout: 20000 },
          )
          .catch(() => {});
        // Let responsive layout + any async content settle.
        await page.waitForTimeout(1200);

        const m = await measure(page);
        expect(m.crashed, `${path} must not crash at ${vp.name}`).toBe(false);
        expect(m.len, `${path} rendered content at ${vp.name}`).toBeGreaterThan(40);
        // 2px tolerance for sub-pixel rounding; anything more is a real break-out.
        expect(
          m.scrollW,
          `${path} has no horizontal overflow at ${vp.width}px (document scrollWidth ${m.scrollW} vs viewport ${m.innerW})`,
        ).toBeLessThanOrEqual(m.innerW + 2);
      });
    }
  }
});
