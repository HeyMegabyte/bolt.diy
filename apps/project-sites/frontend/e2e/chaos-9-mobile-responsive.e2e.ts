/**
 * CHAOS 9 — "The Mobile Visitor": marketing SUB-pages have no horizontal overflow
 * at phone + tablet widths. chaos-5 only checks the homepage; a real mobile user
 * browses pricing/developers/roadmap/etc. Waits for the H1 (lazy routes render
 * ~3-6s after domcontentloaded — a fixed sleep flaked), then asserts the document
 * never overflows the viewport (a classic mobile layout defect).
 */
import { test, expect } from '@playwright/test';

const PAGES = ['/pricing', '/developers', '/roadmap', '/press', '/integrations', '/changelog', '/content'];
const WIDTHS = [375, 768];

for (const url of PAGES) {
  for (const w of WIDTHS) {
    test(`${url} has no horizontal overflow @${w}px`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow ${overflow}px on ${url} @${w}`).toBeLessThanOrEqual(2);
    });
  }
}
