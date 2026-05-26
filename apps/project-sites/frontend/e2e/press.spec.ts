import { test, expect, STUB_USER } from './fixtures';

/**
 * Press kit page — comprehensive E2E coverage.
 *
 * Asserts the /press route renders:
 * - hero + breadcrumb
 * - all 8 walkthrough slides (with native 1920×1080 dimensions, alt text,
 *   per-slide download links)
 * - fact-sheet 6 cards
 * - founder bio with all four contact links
 * - brand assets (logo + palette + typography sections)
 * - press releases timeline
 * - media contacts grid
 *
 * Run anonymous AND authenticated — the press page is public; the only
 * authed-state assertion is that the header swaps the sign-in CTA for the
 * user-menu avatar (covered separately in `header-auth-state.spec.ts`).
 */

test.describe('Press kit page (/press)', () => {
  test('renders hero + breadcrumb anonymously', async ({ anonPage: page }) => {
    await page.goto('/press');
    await expect(page).toHaveTitle(/Press kit — ProjectSites/);
    await expect(page.locator('h1')).toContainText('Everything you need to write about ProjectSites');
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toContainText('Press');
    // Primary + secondary CTA both above the fold
    await expect(page.locator('a.cta-primary', { hasText: /Download brand kit/i })).toBeVisible();
    await expect(page.locator('a.cta-secondary', { hasText: /press@megabyte\.space/ })).toBeVisible();
  });

  test('renders all 8 walkthrough slides at 1920×1080 with alt text', async ({ anonPage: page }) => {
    await page.goto('/press#walkthrough');
    const slides = page.locator('.slides .slide');
    await expect(slides).toHaveCount(8);

    for (let i = 1; i <= 8; i++) {
      const slide = page.locator(`#slide-${i}`);
      await slide.scrollIntoViewIfNeeded();
      await expect(slide).toBeVisible();
      const img = slide.locator('img');
      await expect(img).toHaveAttribute('width', '1920');
      await expect(img).toHaveAttribute('height', '1080');
      // Alt text is non-empty and descriptive
      const alt = await img.getAttribute('alt');
      expect(alt).toBeTruthy();
      expect(alt!.length).toBeGreaterThan(20);
      // Each slide has a download link pointing to /walkthrough/0N-*.jpg
      const dl = slide.locator('a.slide-dl');
      await expect(dl).toBeVisible();
      const dlHref = await dl.getAttribute('href');
      expect(dlHref).toMatch(/^\/walkthrough\/0\d-[a-z]+\.jpg$/);
    }
  });

  test('walkthrough slide #1 uses fetchpriority="high" and eager loading for LCP', async ({ anonPage: page }) => {
    await page.goto('/press');
    const firstImg = page.locator('#slide-1 img');
    await expect(firstImg).toHaveAttribute('loading', 'eager');
    await expect(firstImg).toHaveAttribute('fetchpriority', 'high');
  });

  test('walkthrough slides 2-8 use lazy loading', async ({ anonPage: page }) => {
    await page.goto('/press');
    for (let i = 2; i <= 8; i++) {
      await expect(page.locator(`#slide-${i} img`)).toHaveAttribute('loading', 'lazy');
    }
  });

  test('fact sheet renders 6 cards', async ({ anonPage: page }) => {
    await page.goto('/press');
    await page.locator('section.fact-sheet').scrollIntoViewIfNeeded();
    const cards = page.locator('section.fact-sheet .fact-grid .card');
    await expect(cards).toHaveCount(6);
    await expect(cards.nth(0)).toContainText(/What it is/);
    await expect(cards.nth(1)).toContainText(/Who it.s for/);
    await expect(cards.nth(2)).toContainText(/How it works/);
    await expect(cards.nth(3)).toContainText(/What.s different/);
    await expect(cards.nth(4)).toContainText(/By the numbers/);
    await expect(cards.nth(5)).toContainText(/Tech stack/);
  });

  test('founder section shows Brian + all 4 contact links', async ({ anonPage: page }) => {
    await page.goto('/press#founder');
    await page.locator('#founder').scrollIntoViewIfNeeded();
    await expect(page.locator('#founder h3', { hasText: 'Brian Zalewski' })).toBeVisible();
    await expect(page.locator('blockquote.boilerplate')).toContainText(/ProjectSites by Megabyte Labs/);
    const links = page.locator('.founder-links a');
    await expect(links).toHaveCount(4);
    await expect(page.locator('a.email-link')).toHaveAttribute('href', 'mailto:brian@megabyte.space');
  });

  test('brand assets shows logo + 6 palette swatches + 3 typography samples', async ({ anonPage: page }) => {
    await page.goto('/press#brand-assets');
    await page.locator('#brand-assets').scrollIntoViewIfNeeded();
    await expect(page.locator('.palette .swatch')).toHaveCount(6);
    await expect(page.locator('.type-list li')).toHaveCount(3);
    // Logo download links exist
    const logoLinks = page.locator('.asset-list a');
    expect(await logoLinks.count()).toBeGreaterThanOrEqual(4);
  });

  test('press releases section renders 3 items in reverse-chronological order', async ({ anonPage: page }) => {
    await page.goto('/press#releases');
    await page.locator('#releases').scrollIntoViewIfNeeded();
    const items = page.locator('.release-list .release');
    await expect(items).toHaveCount(3);
    // First two are dated May 25 (same day; either order acceptable), third is May 24
    const dates = await items.locator('time').allTextContents();
    expect(dates[2]).toMatch(/May 24, 2026/);
  });

  test('media contacts shows 4 email rows + response-time line', async ({ anonPage: page }) => {
    await page.goto('/press');
    await page.locator('section.contacts').scrollIntoViewIfNeeded();
    const grid = page.locator('.contact-grid');
    await expect(grid.locator('a[href="mailto:press@megabyte.space"]')).toBeVisible();
    await expect(grid.locator('a[href="mailto:brian@megabyte.space"]')).toBeVisible();
    await expect(grid.locator('a[href="mailto:partners@megabyte.space"]')).toBeVisible();
    await expect(grid.locator('a[href="mailto:invest@megabyte.space"]')).toBeVisible();
    await expect(page.locator('.contact-foot')).toContainText(/Response time/);
  });

  test('signed-in as brian@megabyte.space — header swaps sign-in for user menu', async ({ authedPage: page }) => {
    await page.goto('/press');
    // Sign-in CTA must NOT be present
    await expect(page.locator('.header-signin-btn')).toHaveCount(0);
    // User avatar (first letter of name/email) present
    const avatar = page.locator('.user-avatar').first();
    await expect(avatar).toBeVisible();
    await expect(avatar).toContainText(STUB_USER.email.charAt(0).toUpperCase());
  });

  test('no console errors on load (CSP + JS bundle health)', async ({ anonPage: page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    await page.goto('/press');
    await page.waitForLoadState('networkidle');
    // Allow well-known third-party console noise (analytics in dev) but no
    // ProjectSites / Angular errors.
    const ours = errors.filter((e) => !/posthog|gtag|google-analytics|sentry/i.test(e));
    expect(ours).toEqual([]);
  });
});
