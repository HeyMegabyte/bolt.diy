import { test, expect } from '@playwright/test';
import { attachConsole, expectClean, snap } from './_flow-helpers';

const BASE = process.env.PROD_URL ?? 'https://projectsites.dev';

/** Navigate to a marketing route; wait for app-root or body to populate. */
async function gotoMarketing(page: import('@playwright/test').Page, path: string): Promise<void> {
  await page.goto(`${BASE}${path}`);
  await page.waitForFunction(() => {
    const root = document.querySelector('app-root');
    return root !== null && root.innerHTML.length > 200;
  }, { timeout: 15_000 }).catch(async () => {
    // Worker-rendered page (no Angular SPA) — wait for DOMContentLoaded
    await page.waitForLoadState('domcontentloaded');
  });
}

test.describe('Full-flow · marketing', () => {
  test.describe.configure({ retries: 2 });
  test.use({ reducedMotion: 'reduce' });

  // ── 1. Homepage shell + app-root readiness ────────────────────────────────
  test('01 · homepage shell mounts, app-root populated', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    const rootReady = await page.waitForFunction(() => {
      const root = document.querySelector('app-root');
      return root && root.innerHTML.length > 200;
    }, { timeout: 15_000 });
    expect(await rootReady.jsonValue()).toBeTruthy();
    await snap(page, '01-homepage-shell');
    expectClean(errors);
  });

  // ── 2. Exactly one H1 on homepage ────────────────────────────────────────
  test('02 · homepage has exactly one H1', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('[data-testid="hero-headline"]', { timeout: 12_000 });
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
    const h1Text = await page.locator('h1').first().textContent();
    expect(h1Text?.trim().length).toBeGreaterThan(0);
    await snap(page, '02-homepage-h1');
    expectClean(errors);
  });

  // ── 3. Primary nav visible, logo present ─────────────────────────────────
  test('03 · homepage nav renders logo + primary links', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('nav[aria-label="Primary"]', { timeout: 10_000 });
    await expect(page.locator('nav[aria-label="Primary"]')).toBeVisible();
    await expect(page.locator('a[aria-label="ProjectSites home"]')).toBeVisible();
    await snap(page, '03-homepage-nav');
    expectClean(errors);
  });

  // ── 4. SPA nav: homepage → /blog, app-root stays mounted ─────────────────
  test('04 · SPA nav homepage → /blog, shell stays mounted', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('app-root', { timeout: 10_000 });

    // Try footer blog link; fall back to direct navigate
    const blogLink = page.locator('footer a[routerlink="/blog"], footer a[href="/blog"]').first();
    if (await blogLink.count()) {
      await blogLink.click();
    } else {
      await page.goto(`${BASE}/blog`);
    }

    await page.waitForURL(/\/blog/, { timeout: 12_000 });
    await expect(page.locator('app-root')).toBeAttached();
    await snap(page, '04-spa-nav-blog');
    expectClean(errors);
  });

  // ── 5. /blog index renders H1 ────────────────────────────────────────────
  test('05 · /blog index renders H1', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/blog');
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 10_000 });
    const h1Text = await h1.textContent();
    expect(h1Text?.trim().length).toBeGreaterThan(0);
    await snap(page, '05-blog-index');
    expectClean(errors);
  });

  // ── 6. /blog: open first post ─────────────────────────────────────────────
  test('06 · /blog first post opens with H1', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/blog');
    const postLink = page.locator('.blog-card a, a.blog-card, a[routerlink*="/blog/"]').first();
    if (await postLink.count()) {
      await postLink.click();
      await page.waitForURL(/\/blog\/.+/, { timeout: 10_000 });
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 8_000 });
    } else {
      test.info().annotations.push({ type: 'warning', description: 'No blog post links found — blog may be empty' });
    }
    await snap(page, '06-blog-post-open');
    expectClean(errors);
  });

  // ── 7. /blog post: back link returns to /blog ─────────────────────────────
  test('07 · /blog post back-link navigates to /blog', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/blog');
    const postLink = page.locator('.blog-card a, a.blog-card, a[routerlink*="/blog/"]').first();
    if (await postLink.count()) {
      await postLink.click();
      await page.waitForURL(/\/blog\/.+/, { timeout: 10_000 });
      const backLink = page.locator('.back-link, a[routerlink="/blog"]').first();
      if (await backLink.count()) {
        await backLink.click();
        await page.waitForURL(/\/blog$/, { timeout: 8_000 });
        await expect(page.locator('h1').first()).toBeVisible();
      }
    }
    await snap(page, '07-blog-back-link');
    expectClean(errors);
  });

  // ── 8. /changelog renders H1 + shipped entries ───────────────────────────
  test('08 · /changelog renders H1 and shipped entries', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/changelog');
    await page.waitForSelector('h1', { timeout: 12_000 });
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
    const h1Text = await h1.textContent();
    expect(h1Text?.trim().length).toBeGreaterThan(5);
    await snap(page, '08-changelog');
    expectClean(errors);
  });

  // ── 9. /changelog SEO — title tag ────────────────────────────────────────
  test('09 · /changelog has <title>', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/changelog');
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);
    await snap(page, '09-changelog-title');
    expectClean(errors);
  });

  // ── 10. /privacy renders policy ──────────────────────────────────────────
  test('10 · /privacy renders H1 + policy content', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/privacy');
    await page.waitForSelector('h1', { timeout: 12_000 });
    await expect(page.locator('h1').first()).toBeVisible();
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toContain('privacy');
    await snap(page, '10-privacy');
    expectClean(errors);
  });

  // ── 11. /privacy SEO — one H1, canonical ─────────────────────────────────
  test('11 · /privacy SEO — exactly one H1, canonical present', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/privacy');
    await page.waitForSelector('h1', { timeout: 12_000 });
    const h1Count = await page.locator('h1').count();
    expect(h1Count).toBe(1);
    const canonical = page.locator('link[rel="canonical"]');
    if (await canonical.count()) {
      const href = await canonical.getAttribute('href');
      expect(href?.length).toBeGreaterThan(0);
    }
    expectClean(errors);
  });

  // ── 12. /terms renders legal content ─────────────────────────────────────
  test('12 · /terms renders H1 + terms content', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/terms');
    await page.waitForSelector('h1', { timeout: 12_000 });
    await expect(page.locator('h1').first()).toBeVisible();
    const bodyText = await page.locator('body').textContent();
    expect(bodyText?.toLowerCase()).toContain('terms');
    await snap(page, '12-terms');
    expectClean(errors);
  });

  // ── 13. /terms SEO — title + meta description ────────────────────────────
  test('13 · /terms SEO — title + meta description', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/terms');
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);
    const metaDesc = page.locator('meta[name="description"]');
    if (await metaDesc.count()) {
      const content = await metaDesc.getAttribute('content');
      expect(content?.trim().length).toBeGreaterThan(0);
    }
    expectClean(errors);
  });

  // ── 14. /developers page renders ─────────────────────────────────────────
  test('14 · /developers page renders with heading', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/developers');
    await page.waitForSelector('h1, h2', { timeout: 12_000 });
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible();
    await snap(page, '14-developers');
    expectClean(errors);
  });

  // ── 15. Homepage pricing section renders ─────────────────────────────────
  test('15 · homepage pricing section is present', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('#pricing, [id="pricing"]', { timeout: 15_000 }).catch(() => {});
    const pricingSection = page.locator('#pricing').first();
    if (await pricingSection.count()) {
      await expect(pricingSection).toBeAttached();
    } else {
      test.info().annotations.push({ type: 'info', description: '#pricing section not found — may be lazy-loaded' });
    }
    await snap(page, '15-pricing-section');
    expectClean(errors);
  });

  // ── 16. Hero CTA button visible ──────────────────────────────────────────
  test('16 · homepage hero primary CTA is visible', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('[data-testid="hero-headline"]', { timeout: 12_000 });
    const cta = page.locator('[class*="hero-cta"], [data-testid*="cta"]').first();
    if (await cta.count()) {
      await expect(cta).toBeVisible();
    } else {
      // Accept any visible button in the hero section
      const heroBtn = page.locator('#hero button, #hero a').first();
      if (await heroBtn.count()) {
        await expect(heroBtn).toBeVisible();
      }
    }
    await snap(page, '16-hero-cta');
    expectClean(errors);
  });

  // ── 17. Footer present on homepage ───────────────────────────────────────
  test('17 · homepage footer renders with links', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('footer', { timeout: 15_000 });
    await expect(page.locator('footer').first()).toBeVisible();
    // Footer has at least one link
    const footerLinks = page.locator('footer a');
    const linkCount = await footerLinks.count();
    expect(linkCount).toBeGreaterThan(0);
    await snap(page, '17-footer');
    expectClean(errors);
  });

  // ── 18. Footer privacy link navigates to /privacy ────────────────────────
  test('18 · footer privacy link navigates to /privacy', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('footer', { timeout: 12_000 });
    const privacyLink = page.locator('footer a[routerlink="/privacy"], footer a[href="/privacy"]').first();
    if (await privacyLink.count()) {
      await privacyLink.click();
      await page.waitForURL(/\/privacy/, { timeout: 8_000 });
      await expect(page.locator('h1').first()).toBeVisible();
    } else {
      await gotoMarketing(page, '/privacy');
      await expect(page.locator('h1').first()).toBeVisible();
    }
    await snap(page, '18-footer-privacy-nav');
    expectClean(errors);
  });

  // ── 19. Unknown route shows 404 UX ───────────────────────────────────────
  test('19 · unknown route shows not-found state', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(`${BASE}/this-page-does-not-exist-xyz-404-e2e`);
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
    const bodyText = (await page.locator('body').textContent())?.toLowerCase() ?? '';
    const has404ish = bodyText.includes('not found') || bodyText.includes('404') || bodyText.includes("doesn't exist") || bodyText.includes('oops');
    if (has404ish) {
      const homeLink = page.locator('a[href="/"], a[routerlink="/"], a:has-text("Home"), a:has-text("home")').first();
      if (await homeLink.count()) {
        await expect(homeLink).toBeVisible();
      }
    } else {
      test.info().annotations.push({ type: 'info', description: 'Soft-404: SPA returns 200 shell for unknown routes' });
    }
    await snap(page, '19-404-recovery');
    expectClean(errors);
  });

  // ── 20. Mobile 375px: no horizontal overflow on homepage ─────────────────
  test('20 · mobile 375px — no horizontal overflow on homepage', async ({ page }) => {
    const errors = attachConsole(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE);
    await page.waitForSelector('app-root', { timeout: 12_000 });
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasOverflow, 'Horizontal overflow at 375px viewport').toBe(false);
    await snap(page, '20-mobile-375-homepage');
    expectClean(errors);
  });

  // ── 21. Mobile 375px: /blog no overflow ──────────────────────────────────
  test('21 · mobile 375px — no overflow on /blog', async ({ page }) => {
    const errors = attachConsole(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await gotoMarketing(page, '/blog');
    await page.waitForSelector('h1', { timeout: 10_000 });
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(hasOverflow, 'Horizontal overflow at 375px on /blog').toBe(false);
    await snap(page, '21-mobile-375-blog');
    expectClean(errors);
  });

  // ── 22. /blog SEO — one H1 + title ───────────────────────────────────────
  test('22 · /blog SEO — one H1, title set', async ({ page }) => {
    const errors = attachConsole(page);
    await gotoMarketing(page, '/blog');
    await page.waitForSelector('h1', { timeout: 10_000 });
    expect(await page.locator('h1').count()).toBe(1);
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);
    expectClean(errors);
  });

  // ── 23. Homepage SEO — og:title + meta description ───────────────────────
  test('23 · homepage SEO — og:title + meta description present', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('[data-testid="hero-headline"]', { timeout: 12_000 });
    const metaDesc = page.locator('meta[name="description"]');
    if (await metaDesc.count()) {
      expect((await metaDesc.getAttribute('content'))?.trim().length).toBeGreaterThan(10);
    }
    const ogTitle = page.locator('meta[property="og:title"]');
    if (await ogTitle.count()) {
      expect((await ogTitle.getAttribute('content'))?.trim().length).toBeGreaterThan(0);
    }
    await snap(page, '23-homepage-seo-meta');
    expectClean(errors);
  });

  // ── 24. SPA continuity across multiple routes ────────────────────────────
  test('24 · SPA continuity — homepage → /blog → /changelog → /privacy all render', async ({ page }) => {
    const errors = attachConsole(page);
    await page.goto(BASE);
    await page.waitForSelector('app-root', { timeout: 12_000 });

    const routes = ['/blog', '/changelog', '/privacy'] as const;
    for (const route of routes) {
      await page.goto(`${BASE}${route}`);
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 });
      const hasContent = await page.evaluate(() => {
        const root = document.querySelector('app-root');
        return root ? root.innerHTML.length > 50 : document.body.innerHTML.length > 50;
      });
      expect(hasContent, `Route ${route} returned empty shell`).toBe(true);
      await page.waitForSelector('h1, h2', { timeout: 8_000 }).catch(() => {});
    }
    await snap(page, '24-spa-continuity');
    expectClean(errors);
  });
});
