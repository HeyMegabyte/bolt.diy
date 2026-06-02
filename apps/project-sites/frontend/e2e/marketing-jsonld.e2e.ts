/**
 * @module e2e/marketing-jsonld
 *
 * Guards JSON-LD accuracy on the public surface. The critical invariant:
 * FAQPage structured data appears ONLY where a visible FAQ exists (Google FAQ
 * policy + the "FAQPage only when real Q&A exists" rule). Regression guard for
 * the fix that moved FAQPage out of the global index.html shell (where it
 * incorrectly applied to /privacy, /terms, etc.) into a homepage-only
 * injection that matches the visible accordion.
 */
import { test, expect } from '@playwright/test';

async function faqPageQuestionCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const j = JSON.parse(s.textContent || '{}');
        const nodes = j['@graph'] || [j];
        for (const n of nodes) {
          const t = n['@type'];
          if (t === 'FAQPage' || (Array.isArray(t) && t.includes('FAQPage'))) {
            return Array.isArray(n.mainEntity) ? n.mainEntity.length : 0;
          }
        }
      } catch { /* ignore malformed block */ }
    }
    return 0;
  });
}

test.describe('marketing JSON-LD — FAQPage only where a visible FAQ exists', () => {
  test.describe.configure({ retries: 2 });

  test('homepage has FAQPage matching its visible accordion', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForTimeout(3000); // FAQPage is injected post-hydration
    const qs = await faqPageQuestionCount(page);
    expect(qs, 'homepage FAQPage should have its real Q&A').toBeGreaterThanOrEqual(3);
    await expect(page.getByText(/frequently asked questions/i).first()).toBeVisible({ timeout: 8000 });
  });

  for (const route of ['/privacy', '/terms']) {
    test(`${route} has NO FAQPage (no visible FAQ)`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'load' });
      await page.waitForTimeout(3000);
      const qs = await faqPageQuestionCount(page);
      expect(qs, `${route} must not carry FAQPage schema (no visible FAQ → Google policy)`).toBe(0);
    });
  }
});
