/**
 * jsonld-validity.spec.ts — TDD RED phase
 *
 * Every public page MUST ship at least one `<script type="application/ld+json">`
 * block, and every block MUST:
 *   1. Parse as valid JSON.
 *   2. Carry `@context: "https://schema.org"` (any scheme; we normalize).
 *   3. Carry a `@type` field that resolves to a Schema.org canonical type
 *      (we accept any non-empty string — Google validates the catalog).
 *   4. NOT contain `FAQPage` unless a corresponding accordion / Q&A
 *      surface is visible on the page (anti-FAQPage-padding per
 *      `[[always]]` § JSON-LD).
 *
 * Per `[[website-build-doctrine]]` rule 4 + `[[always]]` § Every page,
 * JSON-LD is the load-bearing carrier for AI-search visibility. This
 * spec is the regression guard against accidentally shipping pages
 * without it (a common Angular hydration gotcha when JSON-LD is rendered
 * client-side instead of SSR'd).
 */

import { test, expect } from '@playwright/test';

const PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/about',
  '/pricing',
  '/blog',
  '/docs',
  '/templates',
  '/contact',
];

interface JsonLdBlock {
  readonly raw: string;
  readonly parsed: Record<string, unknown> | null;
}

async function extractJsonLd(page: import('@playwright/test').Page): Promise<JsonLdBlock[]> {
  const raws = await page.locator('script[type="application/ld+json"]').allTextContents();
  return raws.map((raw) => {
    try {
      return { raw, parsed: JSON.parse(raw) as Record<string, unknown> };
    } catch {
      return { raw, parsed: null };
    }
  });
}

test.describe('JSON-LD validity — public pages', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} ships valid JSON-LD with @context + @type`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      // Some routes (like /blog index) may legitimately 404 in a green-field
      // workspace; skip those rather than fail this gate prematurely.
      if (response && response.status() === 404) {
        test.skip(true, `${route} returns 404 — skipping JSON-LD check`);
      }

      const blocks = await extractJsonLd(page);
      expect(blocks.length, `${route} must ship at least one JSON-LD block`).toBeGreaterThan(0);

      for (const block of blocks) {
        expect(block.parsed, `${route} JSON-LD block must parse: ${block.raw.slice(0, 80)}…`).not.toBeNull();

        const json = block.parsed!;
        // Schema.org allows `@context` either as string OR object with `@vocab`.
        const ctx = json['@context'];
        const ctxString = typeof ctx === 'string' ? ctx : (ctx as { '@vocab'?: string })?.['@vocab'];
        expect(
          ctxString,
          `${route} JSON-LD missing @context`,
        ).toMatch(/https?:\/\/schema\.org/i);

        const type = json['@type'];
        const typeOk = typeof type === 'string' || Array.isArray(type);
        expect(typeOk, `${route} JSON-LD missing @type`).toBe(true);

        if (typeof type === 'string') {
          expect(type.length, `${route} JSON-LD @type must be non-empty`).toBeGreaterThan(0);
        }
      }
    });

    test(`${route} FAQPage schema is honest`, async ({ page }) => {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      if (response && response.status() === 404) {
        test.skip(true, `${route} returns 404 — skipping FAQPage honesty check`);
      }
      const blocks = await extractJsonLd(page);
      const hasFaqSchema = blocks.some((b) => {
        const t = b.parsed?.['@type'];
        return t === 'FAQPage' || (Array.isArray(t) && t.includes('FAQPage'));
      });

      if (!hasFaqSchema) {
        // No FAQPage schema declared — that's allowed.
        return;
      }

      // FAQPage is declared — assert real Q&A is visible on the page.
      const faqMarker = page
        .getByRole('region', { name: /faq|frequently asked/i })
        .or(page.locator('[data-faq]'))
        .or(page.locator('details summary, [role="group"][aria-label*="FAQ" i]'));
      const visibleCount = await faqMarker.count();
      expect(
        visibleCount,
        `${route} declares FAQPage schema but no visible FAQ surface found — anti-padding rule`,
      ).toBeGreaterThan(0);
    });
  }

  test('homepage publishes an Organization schema with name + url + logo', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const blocks = await extractJsonLd(page);
    const orgBlock = blocks.find((b) => {
      const t = b.parsed?.['@type'];
      return t === 'Organization' || (Array.isArray(t) && t.includes('Organization'));
    });
    expect(orgBlock, 'homepage must publish an Organization JSON-LD block').toBeTruthy();
    const parsed = orgBlock!.parsed!;
    expect(parsed['name'], 'Organization.name required').toBeTruthy();
    expect(parsed['url'], 'Organization.url required').toBeTruthy();
    expect(parsed['logo'], 'Organization.logo required').toBeTruthy();
  });

  test('homepage publishes a BreadcrumbList or WebSite schema', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const blocks = await extractJsonLd(page);
    const ok = blocks.some((b) => {
      const t = b.parsed?.['@type'];
      return (
        t === 'WebSite' ||
        t === 'BreadcrumbList' ||
        (Array.isArray(t) && (t.includes('WebSite') || t.includes('BreadcrumbList')))
      );
    });
    expect(ok, 'homepage must ship WebSite or BreadcrumbList schema').toBe(true);
  });
});
