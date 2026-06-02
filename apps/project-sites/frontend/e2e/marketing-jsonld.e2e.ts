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

/**
 * Per-route WebPage + BreadcrumbList accuracy. Regression guard for the fix that
 * removed the duplicate/stale WebPage: the worker injected a WebPage hardcoded to
 * the homepage url on EVERY route, and a prior Angular round added a second
 * per-route one. Now MetaService.upsertRouteStructuredData mutates the server
 * graph in place → exactly ONE WebPage, route-accurate, plus a Home > <segment>
 * breadcrumb (never the old "Home > Create > Dashboard" funnel).
 */
async function structuredData(page: import('@playwright/test').Page): Promise<{
  webPageUrls: string[];
  breadcrumbTrails: string[];
}> {
  return page.evaluate(() => {
    const webPageUrls: string[] = [];
    const breadcrumbTrails: string[] = [];
    for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      try {
        const j = JSON.parse(s.textContent || '{}');
        for (const n of j['@graph'] || [j]) {
          const t = Array.isArray(n['@type']) ? n['@type'].join('/') : n['@type'] || '';
          if (t.includes('WebPage') && n.url) webPageUrls.push(n.url as string);
          if (t.includes('BreadcrumbList')) {
            breadcrumbTrails.push(
              (n.itemListElement || []).map((i: { name: string }) => i.name).join(' > '),
            );
          }
        }
      } catch {
        /* ignore malformed block */
      }
    }
    return { webPageUrls, breadcrumbTrails };
  });
}

test.describe('marketing JSON-LD — exactly one route-accurate WebPage + BreadcrumbList', () => {
  test.describe.configure({ retries: 2 });

  const cases: { route: string; expectUrl: string; crumb: RegExp }[] = [
    { route: '/', expectUrl: 'https://projectsites.dev/', crumb: /^Home$/ },
    { route: '/privacy', expectUrl: 'https://projectsites.dev/privacy', crumb: /Home > Privacy/ },
    { route: '/blog', expectUrl: 'https://projectsites.dev/blog', crumb: /Home > Blog/ },
    { route: '/roadmap', expectUrl: 'https://projectsites.dev/roadmap', crumb: /Home > Roadmap/ },
  ];

  for (const { route, expectUrl, crumb } of cases) {
    test(`${route}: single WebPage @ own url + accurate breadcrumb (no duplicate)`, async ({
      page,
    }) => {
      await page.goto(route, { waitUntil: 'load' });
      await page.waitForTimeout(3500); // structured data is finalized post-hydration
      const { webPageUrls, breadcrumbTrails } = await structuredData(page);

      expect(
        webPageUrls.length,
        `${route} must have exactly ONE WebPage node (got ${JSON.stringify(webPageUrls)})`,
      ).toBe(1);
      expect(webPageUrls[0], `${route} WebPage.url must be this route, not the homepage`).toBe(
        expectUrl,
      );

      const trail = breadcrumbTrails.join(' | ');
      expect(trail, `${route} breadcrumb must be accurate (was a stale funnel)`).toMatch(crumb);
      // The old global funnel must never reappear on a non-create route.
      if (route !== '/') {
        expect(trail).not.toContain('Dashboard');
        expect(trail).not.toContain('Create Your Website');
      }
    });
  }
});
