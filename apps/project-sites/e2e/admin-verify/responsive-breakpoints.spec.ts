/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — completes the mandate's explicit
 * "6 breakpoints" responsive requirement (375/390/768/1024/1280/1920). P0.108/109
 * covered 375 + 768 on the card + table sections; this covers the remaining FOUR
 * (390 mobile-L, 1024 laptop, 1280 desktop, 1920 wide) across the same 6 sections —
 * asserting no horizontal overflow / no crash / content rendered at each.
 *
 * NON-MUTATING: pure navigation + layout measurement. A document `scrollWidth` wider
 * than the viewport is a real break-out (an in-page `overflow-x-auto` container that
 * clips its content does NOT widen the document, so this only flags genuine bugs).
 *
 * @see {@link ./responsive-admin.spec.ts} {@link ./responsive-tables.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const BREAKPOINTS = [
  { name: 'mobile-L', width: 390, height: 844 },
  { name: 'laptop', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'wide', width: 1920, height: 1080 },
];
const SECTIONS = ['/admin', '/admin/apps', '/admin/docs', '/admin/api-tokens', '/admin/ai-endpoints', '/admin/audit'];

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

test.describe('Admin · responsive — remaining breakpoints, no horizontal overflow (P0-ADMIN)', () => {
  for (const bp of BREAKPOINTS) {
    for (const path of SECTIONS) {
      test(`${path} has no horizontal overflow at ${bp.name} (${bp.width}px)`, async ({ page }) => {
        test.skip(!realDataAvailable(), 'needs E2E_API_KEY for the authed admin shell');
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await setupRealDataPage(page, { passthrough: /\/api\// });
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page
          .waitForFunction(
            () => (document.querySelector('main')?.innerText || document.body.innerText || '').trim().length > 40,
            undefined,
            { timeout: 20000 },
          )
          .catch(() => {});
        await page.waitForTimeout(1000);

        const m = await measure(page);
        expect(m.crashed, `${path} must not crash at ${bp.name}`).toBe(false);
        expect(m.len, `${path} rendered content at ${bp.name}`).toBeGreaterThan(40);
        expect(
          m.scrollW,
          `${path} horizontal overflow at ${bp.width}px (document scrollWidth ${m.scrollW} vs viewport ${m.innerW})`,
        ).toBeLessThanOrEqual(m.innerW + 2);
      });
    }
  }
});
