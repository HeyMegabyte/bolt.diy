import { test, expect } from './fixtures';

/**
 * Logo styling — wordmark must match the icon height visually and render
 * fully opaque. The previous styling applied `opacity: 0.9` + `margin-top: 5px`
 * to the wordmark which broke alignment + brand parity.
 *
 * Spec asserts the rendered (computed) CSS values, not just the source — a
 * regression that re-introduces opacity 0.9 will fail here.
 */

test.describe('Header logo styling', () => {
  test('icon + wordmark have matching visual height', async ({ anonPage: page }) => {
    await page.goto('/press');
    const icon = page.locator('.logo .logo-icon');
    const wordmark = page.locator('.logo .logo-text-img');
    await expect(icon).toBeVisible();
    await expect(wordmark).toBeVisible();

    const iconBox = await icon.boundingBox();
    const wordBox = await wordmark.boundingBox();
    expect(iconBox).not.toBeNull();
    expect(wordBox).not.toBeNull();
    // Allow 1px tolerance for sub-pixel rendering — both should hit 48px.
    expect(Math.abs(iconBox!.height - wordBox!.height)).toBeLessThanOrEqual(1);
  });

  test('wordmark renders fully opaque (opacity === 1)', async ({ anonPage: page }) => {
    await page.goto('/press');
    const wordmark = page.locator('.logo .logo-text-img');
    const opacity = await wordmark.evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe('1');
  });

  test('wordmark has no vertical margin offset (margin-top === 0)', async ({ anonPage: page }) => {
    await page.goto('/press');
    const wordmark = page.locator('.logo .logo-text-img');
    const marginTop = await wordmark.evaluate((el) => getComputedStyle(el).marginTop);
    expect(marginTop).toBe('0px');
  });

  test('hovering the logo does not dim the wordmark', async ({ anonPage: page }) => {
    await page.goto('/press');
    const wordmark = page.locator('.logo .logo-text-img');
    await page.locator('.logo').hover();
    const opacity = await wordmark.evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe('1');
  });
});

test.describe('Homepage hero copy + meta', () => {
  test('document title matches current hero copy (no stale "Your Website, Handled. Finally.")', async ({ anonPage: page }) => {
    await page.goto('/');
    const title = await page.title();
    // OLD stale copy must not be in the title
    expect(title).not.toMatch(/Your Website, Handled\. Finally/i);
    // NEW copy or a sensible default
    expect(title).toMatch(/ProjectSites/);
    expect(title.length).toBeGreaterThanOrEqual(20);
    expect(title.length).toBeLessThanOrEqual(70);
  });

  test('hero H1 reads "We don\'t sell websites. We deliver them."', async ({ anonPage: page }) => {
    await page.goto('/');
    const h1 = page.locator('h1.cl-headline');
    await expect(h1).toBeVisible();
    const text = (await h1.textContent())?.replace(/\s+/g, ' ').trim();
    expect(text).toMatch(/We don['’]t sell websites\.\s*We deliver them\./);
  });

  test('meta description reflects the AI-native value prop', async ({ anonPage: page }) => {
    await page.goto('/');
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc).toBeTruthy();
    expect(desc!.length).toBeLessThanOrEqual(180);
    expect(desc).toMatch(/AI/i);
  });
});
