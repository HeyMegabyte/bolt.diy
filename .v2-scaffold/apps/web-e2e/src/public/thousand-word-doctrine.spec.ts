/**
 * thousand-word-doctrine.spec.ts — TDD RED phase
 *
 * Every public-facing marketing / docs / blog page MUST ship:
 *   - ≥ 1000 words inside `<main>` (or `[role="main"]` / `[data-main]`),
 *     stripped of script + style + nav + footer + aside + form.
 *   - ≥ 4 multimedia elements — `<img>` / `<picture>` / `<video>` /
 *     `<svg>` / `<canvas>` / `<iframe>` / `<audio>` / `<model-viewer>` /
 *     elements with `data-media="true"`.
 *
 * Source: `[[website-build-doctrine]]` Phase 2 (Maximalist Page
 * Enrichment) + `[[thin-source-amplification]]` minimum-viable-content
 * floor. Marketing surfaces that ship below the floor are AI-slop by
 * definition.
 */

import { test, expect } from '@playwright/test';

/**
 * Routes that MUST satisfy the 1000-word doctrine. Blog + docs + templates
 * each get representative sample routes; the full sitemap will be checked
 * via a separate sweep job, not this hermetic spec.
 */
const QUALIFYING_ROUTES: readonly string[] = [
  '/',
  '/about',
  '/pricing',
  '/blog/launching-projectsites',
  '/docs/getting-started',
  '/templates/saas-landing',
];

const MIN_WORDS = 1000;
const MIN_MULTIMEDIA = 4;

interface PageStats {
  readonly wordCount: number;
  readonly multimediaCount: number;
  readonly headings: number;
  readonly hasJsonLd: boolean;
}

test.describe('thousand-word doctrine — public pages', () => {
  for (const route of QUALIFYING_ROUTES) {
    test(`${route} ships ≥1000 words and ≥4 multimedia in <main>`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp(route.replace(/[/]/g, '\\/')));

      // Make sure the main content has hydrated — avoid counting words
      // before incremental hydration runs.
      await page
        .locator('main, [role="main"], [data-main]')
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 });

      const stats = await page.evaluate<PageStats>(() => {
        const root =
          document.querySelector('main') ??
          document.querySelector('[role="main"]') ??
          document.querySelector('[data-main]');
        if (!root) {
          return { wordCount: 0, multimediaCount: 0, headings: 0, hasJsonLd: false };
        }

        // Strip noise — clone the subtree so we don't mutate the live DOM.
        const clone = root.cloneNode(true) as HTMLElement;
        for (const selector of [
          'script',
          'style',
          'noscript',
          'template',
          'nav',
          'footer',
          'aside',
          'form',
          '[data-skip-wordcount]',
        ]) {
          clone.querySelectorAll(selector).forEach((el) => el.remove());
        }

        const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
        const words = text.length === 0 ? 0 : text.split(/\s+/).length;

        const mediaSelectors = [
          'img',
          'picture',
          'video',
          'svg',
          'canvas',
          'iframe',
          'audio',
          'model-viewer',
          '[data-media="true"]',
        ].join(',');
        const multimedia = root.querySelectorAll(mediaSelectors).length;

        const headings = root.querySelectorAll('h1, h2, h3').length;
        const hasJsonLd =
          document.querySelectorAll('script[type="application/ld+json"]').length > 0;

        return { wordCount: words, multimediaCount: multimedia, headings, hasJsonLd };
      });

      expect(
        stats.wordCount,
        `route ${route} has ${stats.wordCount} words; minimum is ${MIN_WORDS}`,
      ).toBeGreaterThanOrEqual(MIN_WORDS);

      expect(
        stats.multimediaCount,
        `route ${route} has ${stats.multimediaCount} multimedia elements; minimum is ${MIN_MULTIMEDIA}`,
      ).toBeGreaterThanOrEqual(MIN_MULTIMEDIA);

      // Soft assertions to surface companion issues without failing the
      // build twice for the same root cause.
      expect(stats.headings, 'public pages should ship at least one heading').toBeGreaterThan(0);
      expect(stats.hasJsonLd, 'public pages should ship at least one JSON-LD block').toBe(true);
    });
  }

  test('homepage exposes a non-empty meta description', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const description = await page
      .locator('meta[name="description"]')
      .first()
      .getAttribute('content');
    expect(description, 'meta description must exist').toBeTruthy();
    const len = (description ?? '').length;
    expect(len, `meta desc length ${len} not in 120-156 range`).toBeGreaterThanOrEqual(120);
    expect(len).toBeLessThanOrEqual(160);
  });
});
