/**
 * @module e2e/marketing-meta-clientnav
 * @description Production regression guard for the two client-side SEO/a11y
 * behaviors shipped in `24c7b2c04` (blog client-nav meta guard + search input
 * accessible names). These are CLIENT-side behaviors that `marketing-seo.spec.ts`
 * cannot catch — it uses `page.goto()` per route, which reads the correct
 * SSR/hydrated `<title>`. The bug this guards against only manifests on a real
 * in-app SPA navigation: clicking through to `/blog/:slug` used to leave the
 * homepage `MetaService` stamping the HOMEPAGE title over the post's title
 * (fixed by `isComponentOwnedMetaRoute` + `BlogPost` stamping its own `setMeta`).
 *
 * Run in isolation:
 * ```sh
 * PROD_URL=https://projectsites.dev npx playwright test marketing-meta-clientnav --config playwright.prod.config.ts
 * ```
 *
 * @see {@link ../src/app/services/meta.service.ts} — MetaService + PAGE_META + isComponentOwnedMetaRoute
 * @see {@link ../src/app/pages/blog/blog-post.component.ts} — BlogPost stamps its own setMeta
 */
import { test, expect } from '@playwright/test';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

test.describe('Blog client-nav meta guard', () => {
  test('SPA-navigating to a blog post stamps the post title, not the homepage title', async ({
    page,
  }) => {
    // Capture the homepage title dynamically (robust to copy changes).
    await page.goto(`${PROD_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').first().waitFor({ timeout: 15_000 });
    const homeTitle = (await page.title()).trim();
    expect(homeTitle.length, 'homepage must have a title').toBeGreaterThan(5);

    // Load the blog index and find a real /blog/:slug post link.
    await page.goto(`${PROD_URL}/blog`, { waitUntil: 'domcontentloaded' });
    await page.locator('h1').first().waitFor({ timeout: 15_000 });
    const postHrefs = await page.$$eval('a[href*="/blog/"]', (as) =>
      as
        .map((a) => a.getAttribute('href') || '')
        .filter((h) => /\/blog\/[^/]+$/.test(h)),
    );
    expect(postHrefs.length, 'blog index must list at least one post').toBeGreaterThan(0);
    const href = postHrefs[0];

    // Real SPA click — do NOT page.goto the post (that would read the SSR title
    // and miss the client-nav clobber this test exists to catch).
    await page.click(`a[href="${href}"]`);
    await page.waitForURL(/\/blog\/[^/]+$/, { timeout: 15_000 });
    await page.locator('h1').first().waitFor({ timeout: 15_000 });
    // MetaService/BlogPost stamps the title after NavigationEnd; give it a beat.
    await expect
      .poll(async () => (await page.title()).trim(), { timeout: 10_000 })
      .not.toBe(homeTitle);

    const postTitle = (await page.title()).trim();
    const h1 = (await page.locator('h1').first().innerText()).trim();
    expect(postTitle, 'post title must not be the homepage title after client nav').not.toBe(
      homeTitle,
    );
    expect(postTitle.length, 'post title must be non-empty').toBeGreaterThan(5);
    // The stamped title should reference the post — share a significant word with the H1.
    const h1Words = h1
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 4);
    const titleLc = postTitle.toLowerCase();
    expect(
      h1Words.some((w) => titleLc.includes(w)),
      `post title "${postTitle}" should relate to the post H1 "${h1}"`,
    ).toBe(true);
  });
});

test.describe('Public search inputs — accessible names', () => {
  for (const route of ['/', '/search']) {
    test(`inputs on ${route} expose a non-placeholder accessible name`, async ({ page }) => {
      await page.goto(`${PROD_URL}${route}`, { waitUntil: 'domcontentloaded' });
      await page.locator('input').first().waitFor({ timeout: 15_000 });
      const inputs = await page.$$eval(
        'input[type="search"], input[type="text"], input:not([type])',
        (els) =>
          els
            .filter((el) => el.getClientRects().length > 0) // visible only
            .map((el) => ({
              aria: (el.getAttribute('aria-label') || '').trim(),
              labelledby: (el.getAttribute('aria-labelledby') || '').trim(),
              hasLabel: !!(
                el.labels &&
                el.labels.length &&
                [...el.labels].some((l) => (l.textContent || '').trim())
              ),
              placeholder: (el.getAttribute('placeholder') || '').trim(),
            })),
      );
      expect(inputs.length, `${route} must render at least one visible text input`).toBeGreaterThan(
        0,
      );
      for (const [i, inp] of inputs.entries()) {
        const accessibleName = inp.aria || inp.labelledby || (inp.hasLabel ? 'label' : '');
        expect(
          accessibleName,
          `${route} input#${i} needs an accessible name (aria-label/label), not just placeholder="${inp.placeholder}"`,
        ).not.toBe('');
      }
    });
  }
});
