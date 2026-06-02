/**
 * @module e2e/marketing-responsive
 *
 * Responsive a11y for the PUBLIC marketing pages — the whole-project counterpart
 * to admin-a11y-mobile + admin-reflow:
 *   - 390px: WCAG 2.2 axe (target-size, mobile layout)
 *   - 320px: WCAG 1.4.10 reflow (no real element overflows the viewport)
 *
 * Covers the marketing pages that are NOT concurrent-session-owned or
 * worker-served: blog / press / privacy / terms / roadmap / integrations.
 * (Excluded: / + /contact + /signin = concurrent-dirty homepage/signin files;
 * /status + /changelog = worker-served — see marketing-a11y.e2e.ts header.)
 *
 * Run: npx playwright test --config=playwright.prod.config.ts marketing-responsive
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = ['/blog', '/press', '/privacy', '/terms', '/roadmap', '/integrations'];

test.describe('marketing — responsive a11y (390 axe + 320 reflow)', () => {
  test.describe.configure({ retries: 2 });

  test.describe('390px mobile axe', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    for (const path of ROUTES) {
      test(`no serious/critical @390px — ${path}`, async ({ page }) => {
        test.setTimeout(60000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(path, { waitUntil: 'load' });
        await expect(page.locator('main, header, body').first()).toBeVisible({ timeout: 30000 });
        await page.waitForTimeout(700);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .exclude('iframe').exclude('.ag-root').analyze();
        const blocking = results.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => `${v.impact} · ${v.id} · ${v.nodes.length}× · ${v.nodes[0]?.target?.join(' ') ?? ''}`);
        expect(blocking, `${path} @390px\n${blocking.join('\n')}`).toEqual([]);
      });
    }
  });

  test.describe('320px reflow', () => {
    test.use({ viewport: { width: 320, height: 800 } });
    for (const path of ROUTES) {
      test(`no element overflows @320px — ${path}`, async ({ page }) => {
        test.setTimeout(60000);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(path, { waitUntil: 'load' });
        await expect(page.locator('main, header, body').first()).toBeVisible({ timeout: 30000 });
        await page.addStyleTag({ content: 'html{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}' });
        await page.waitForTimeout(1400);
        // Real overflow only: not position fixed/sticky, not clipped by an ancestor.
        const culprits = await page.evaluate(() => {
          const vw = window.innerWidth;
          const clipped = (el: Element): boolean => {
            let n = el.parentElement;
            while (n && n !== document.body) {
              const s = getComputedStyle(n);
              if (['hidden', 'clip', 'auto', 'scroll'].includes(s.overflowX)) return true;
              if (['fixed', 'sticky'].includes(s.position)) return true;
              n = n.parentElement;
            }
            return false;
          };
          const found: string[] = [];
          for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
            const s = getComputedStyle(el);
            if (s.position === 'fixed' || s.position === 'sticky') continue;
            const r = el.getBoundingClientRect();
            if (r.right > vw + 4 && r.width > 1 && !clipped(el)) {
              found.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ').slice(0, 2).join('.')} (right=${Math.round(r.right)})`);
            }
          }
          return found.slice(0, 5);
        });
        expect(culprits, `${path} overflows @320px:\n${culprits.join('\n')}`).toEqual([]);
      });
    }
  });
});
