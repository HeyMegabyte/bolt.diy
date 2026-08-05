/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — the TABLE/LIST-heavy admin sections render at
 * MOBILE (375) and TABLET (768) WITHOUT horizontal overflow. Data tables are the #1
 * responsive break source (a wide `<table>` without an `overflow-x-auto` wrapper pushes
 * the document past the viewport at 375px), so these are the highest-value responsive
 * checks — distinct from responsive-admin.spec.ts (card/hub sections).
 *
 * NON-MUTATING: pure navigation + layout measurement. Document `scrollWidth` wider than
 * the viewport = a real break-out (an in-page `overflow-x-auto` container that clips its
 * own content does NOT widen the document, so this only flags genuine bugs).
 *
 * @see {@link ./responsive-admin.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
];
// Org-level, table/list-bearing sections (api-tokens grid, AI-agents list, audit log).
const SECTIONS = ['/admin/api-tokens', '/admin/ai-endpoints', '/admin/audit'];

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

test.describe('Admin · responsive table/list sections — no horizontal overflow (P0-ADMIN)', () => {
  for (const vp of VIEWPORTS) {
    for (const path of SECTIONS) {
      test(`${path} has no horizontal overflow at ${vp.name} (${vp.width}px)`, async ({ page }) => {
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
        await page.waitForTimeout(1500); // let the list/table + async data settle

        const m = await measure(page);
        expect(m.crashed, `${path} must not crash at ${vp.name}`).toBe(false);
        expect(m.len, `${path} rendered content at ${vp.name}`).toBeGreaterThan(40);
        expect(
          m.scrollW,
          `${path} has no horizontal overflow at ${vp.width}px (document scrollWidth ${m.scrollW} vs viewport ${m.innerW})`,
        ).toBeLessThanOrEqual(m.innerW + 2);
      });
    }
  }
});
