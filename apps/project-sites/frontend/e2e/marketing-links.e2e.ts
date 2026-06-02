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
