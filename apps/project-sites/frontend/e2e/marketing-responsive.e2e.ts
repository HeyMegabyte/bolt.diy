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

// '/', '/contact', '/signin' joined once their a11y blocks cleared (see
// marketing-a11y.e2e.ts header). All verified reflow-clean @320px live.
const ROUTES = [
  '/', '/contact', '/signin',
  '/blog', '/press', '/privacy', '/terms', '/roadmap', '/integrations',
];

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

test.describe('marketing — integrations logos resolve (no dead clearbit API)', () => {
  test.describe.configure({ retries: 2 });
  test.use({ viewport: { width: 1280, height: 900 } });

  // Regression: the integrations grid sourced logos from logo.clearbit.com,
  // whose free API HubSpot shut down (Dec 2024) → ERR_NAME_NOT_RESOLVED on every
  // load + broken images. The component now rewrites them to a reliable source
  // (Google favicons) before render. Guard that no dead clearbit URL returns and
  // the logos actually load.
  test('every integration logo loads from a live source — no clearbit, no broken images', async ({ page }) => {
    test.setTimeout(60000);
    const failedLogos: string[] = [];
    page.on('requestfailed', (r) => {
      if (/logo\.clearbit\.com/.test(r.url())) failedLogos.push(r.url());
    });
    await page.goto('/integrations', { waitUntil: 'load' });
    await expect(page.locator('main, body').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);
    const stats = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('.logo-tile img'));
      return {
        total: imgs.length,
        clearbit: imgs.filter((i) => i.src.includes('clearbit')).length,
        loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      };
    });
    expect(stats.total, 'integration logo tiles render').toBeGreaterThan(10);
    expect(stats.clearbit, 'no dead clearbit logo URLs in the DOM').toBe(0);
    expect(failedLogos, `clearbit requests still firing:\n${failedLogos.join('\n')}`).toEqual([]);
    expect(stats.loaded, 'the large majority of logos load (naturalWidth>0)').toBeGreaterThan(stats.total * 0.8);
  });
});

test.describe('marketing — OG image within budget', () => {
  test.describe.configure({ retries: 2 });

  // Regression: the shared OG card (og-image.jpg) must stay 1200×630 AND
  // <= 100KB per the asset budget (it was a 235KB PNG; re-encoded to a ~95KB
  // mozjpeg q90). Social cards balloon silently when someone drops in a new PNG.
  test('og-image.jpg is served, image/jpeg, and <= 100KB', async ({ page }) => {
    test.setTimeout(30000);
    const res = await page.request.get('https://projectsites.dev/og-image.jpg', { failOnStatusCode: false });
    expect(res.status(), 'og-image.jpg resolves').toBe(200);
    expect(res.headers()['content-type'] ?? '', 'served as JPEG').toContain('image/jpeg');
    const bytes = (await res.body()).length;
    expect(bytes, `og-image.jpg is ${Math.round(bytes / 1024)}KB — must be <= 100KB`).toBeLessThanOrEqual(100 * 1024);
  });

  test('homepage og:image points to the .jpg card', async ({ page }) => {
    test.setTimeout(30000);
    await page.goto('/', { waitUntil: 'load' });
    const og = await page.locator('meta[property="og:image"]').first().getAttribute('content');
    expect(og ?? '', 'og:image uses the .jpg card').toContain('og-image.jpg');
  });
});

test.describe('marketing — required favicon files serve real images', () => {
  test.describe.configure({ retries: 2 });

  // Regression: favicon-16x16.png / favicon-32x32.png (always.md required-file
  // names + what SEO/favicon tools probe) were absent, so the worker served its
  // 156-byte JSON catch-all with HTTP 200 + content-type application/json — a
  // favicon that's actually JSON. Now provided as real PNGs in public/.
  for (const f of ['favicon-16x16.png', 'favicon-32x32.png', 'favicon.ico']) {
    test(`/${f} is a real image, not the JSON fallback`, async ({ page }) => {
      test.setTimeout(20000);
      const res = await page.request.get(`https://projectsites.dev/${f}`, { failOnStatusCode: false });
      expect(res.status(), `${f} resolves`).toBe(200);
      const ct = res.headers()['content-type'] ?? '';
      expect(ct, `${f} served as an image (not JSON), got: ${ct}`).toMatch(/^image\//);
    });
  }
});
