/**
 * @module e2e/marketing-links
 *
 * Broken-internal-link guard for the public marketing surface. Crawls the key
 * marketing pages, collects every internal `<a href>` (and static assets they
 * reference), and asserts each resolves (no 4xx/5xx). Caught the dead
 * `/changelog` footer link (flag-gated-off → 404), removed 2026-06-02.
 *
 * Visitor-facing — no auth. Run:
 *   npx playwright test --config=playwright.prod.config.ts marketing-links
 */
import { test, expect, request as pwRequest } from '@playwright/test';

const BASE = 'https://projectsites.dev';
const PAGES = ['/', '/pricing', '/features', '/integrations', '/roadmap', '/press', '/blog', '/about', '/contact', '/status'];

// Targets intentionally not publicly reachable (e.g. behind an experimental
// flag). Add here only with a documented reason; prefer removing the link.
const KNOWN_PENDING = new Set<string>([]);

test.describe('marketing — no broken internal links', () => {
  test.describe.configure({ retries: 2 });

  test('every internal link on the public pages resolves (no 4xx/5xx)', async ({ page }) => {
    test.setTimeout(120000);
    const targets = new Set<string>();
    for (const pg of PAGES) {
      await page.goto(BASE + pg, { waitUntil: 'load' }).catch(() => {});
      await page.waitForTimeout(1000);
      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
      );
      for (const h of hrefs) {
        if (h && h.startsWith('/') && !h.startsWith('//')) targets.add(h.split('#')[0].split('?')[0]);
      }
    }
    targets.delete('');

    const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { 'User-Agent': 'Mozilla/5.0 (marketing-links-e2e)' } });
    const broken: string[] = [];
    for (const u of targets) {
      if (KNOWN_PENDING.has(u)) continue;
      const res = await ctx.get(u, { maxRedirects: 5 }).catch(() => null);
      const st = res ? res.status() : 0;
      if (st >= 400 || st === 0) broken.push(`${st} ${u}`);
    }
    await ctx.dispose();

    expect(broken, `broken internal marketing links:\n${broken.join('\n')}`).toEqual([]);
  });
});

/**
 * Regression: the footer "About" link used to point at `routerLink="/search"`
 * (the business-search page) — a semantic mislink the broken-link crawler above
 * could never catch, since `/search` returns 200. "About" must lead to product
 * info; it now scrolls to the on-page `#how-it-works` section. Fixed 2026-08-15.
 */
test.describe('marketing — footer "About" leads to product info, not business search', () => {
  test.describe.configure({ retries: 2 });

  test('footer About scrolls to #how-it-works and never links to /search', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    // Real hydration gate — the sticky nav proves the Angular homepage mounted.
    await page.waitForSelector('nav[aria-label="Primary"]', { state: 'attached', timeout: 15000 });

    // The old mislink must be gone: no "About"-labelled anchor to /search.
    const strayAbout = await page.locator('a[href="/search"], a[routerlink="/search"]').count();
    expect(strayAbout, 'no marketing link may point "About" at /search').toBe(0);

    // "About" is now a button (an in-page scroll action, not navigation).
    const about = page.getByRole('button', { name: 'About', exact: true }).first();
    await about.scrollIntoViewIfNeeded();
    await expect(about).toBeVisible();
    await about.click();
    await page.waitForTimeout(900);

    // It must NOT navigate away from the homepage …
    expect(new URL(page.url()).pathname, 'About must not navigate away from /').toBe('/');
    // … and the How-It-Works section must be scrolled into view.
    const inView = await page.evaluate(() => {
      const el = document.getElementById('how-it-works');
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    });
    expect(inView, '#how-it-works must be in view after clicking footer About').toBe(true);
  });
});
