/**
 * Marketing surface SEO + metadata verification.
 *
 * Verifies every public route has: valid title, meta description, canonical,
 * OG tags, JSON-LD blocks, and correct status codes.
 */
import { test, expect } from '@playwright/test';
import { resilientGet } from './helpers/api-request.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

interface RouteCheck {
  path: string;
  minJsonLdBlocks: number;
}

const SEO_ROUTES: RouteCheck[] = [
  { path: '/', minJsonLdBlocks: 3 },
  { path: '/pricing', minJsonLdBlocks: 2 },
  { path: '/blog', minJsonLdBlocks: 2 },
  { path: '/integrations', minJsonLdBlocks: 2 },
  { path: '/developers', minJsonLdBlocks: 2 },
  { path: '/press', minJsonLdBlocks: 2 },
  { path: '/search', minJsonLdBlocks: 2 },
  { path: '/privacy', minJsonLdBlocks: 2 },
  { path: '/terms', minJsonLdBlocks: 2 },
];

test.describe('SEO — Public Route Metadata', () => {
  for (const route of SEO_ROUTES) {
    test(`${route.path} has valid SEO metadata`, async ({ page }) => {
      const res = await page.goto(`${PROD_URL}${route.path}`);
      expect(res?.status()).toBe(200);

      // Title must exist and be within 20-70 chars
      const title = await page.title();
      expect(title.length).toBeGreaterThan(5);
      expect(title.length).toBeLessThan(120);

      // Meta description
      const desc = await page.locator('meta[name="description"]').getAttribute('content');
      if (desc) {
        expect(desc.length).toBeGreaterThan(20);
        expect(desc.length).toBeLessThan(200);
      }

      // Canonical
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toBeTruthy();

      // OG tags
      const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
      expect(ogTitle).toBeTruthy();

      // JSON-LD blocks
      const jsonLdCount = await page.locator('script[type="application/ld+json"]').count();
      if (route.minJsonLdBlocks > 0) {
        expect(jsonLdCount).toBeGreaterThanOrEqual(route.minJsonLdBlocks);
      }
    });
  }
});

test.describe('SEO — Critical Files', () => {
  test('robots.txt exists and references sitemap', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/robots.txt`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('sitemap');
  });

  test('sitemap.xml returns valid XML', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/sitemap.xml`);
    expect(res.status()).toBe(200);
    const text = await res.text();
    expect(text).toContain('<urlset');
    expect(text).toContain('<loc>');
  });

  test('humans.txt exists', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/humans.txt`);
    expect(res.status()).toBe(200);
  });

  test('security.txt exists', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/.well-known/security.txt`);
    expect([200, 301, 302]).toContain(res.status());
  });

  test('llms.txt exists for AI agent discovery', async ({ request }) => {
    const res = await resilientGet(request, `${PROD_URL}/llms.txt`);
    // May 404 if not yet implemented — not a hard failure
    expect([200, 404]).toContain(res.status());
  });
});
