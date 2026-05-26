import { test, expect } from './fixtures';

/**
 * Visual regression — homepage hero + header logo.
 *
 * Stable screenshots gated by `mask`-ed animation regions to keep them
 * deterministic across runs. Updates require `--update-snapshots`.
 *
 * Run via:
 *   npx playwright test e2e/hero-logo-visual.spec.ts
 *   npx playwright test e2e/hero-logo-visual.spec.ts --update-snapshots
 */

test.describe('Visual regression — hero + logo', () => {
  test.use({
    // Disable animations + force reduced-motion so screenshots aren't
    // capturing mid-animation frames.
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });

  test('header logo at 1280×800 desktop', async ({ anonPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/press');
    await page.waitForLoadState('networkidle');
    const logo = page.locator('.logo');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveScreenshot('header-logo-desktop.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('header logo at 390×844 mobile (iPhone 14)', async ({ anonPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/press');
    await page.waitForLoadState('networkidle');
    const logo = page.locator('.logo');
    await expect(logo).toBeVisible();
    await expect(logo).toHaveScreenshot('header-logo-mobile.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('cinematic hero block at 1280×800', async ({ anonPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Wait for the hero to fully render — the typed sub-line animation
    // is masked below to avoid flake, but the headline + pill must paint.
    await page.locator('h1.cl-headline').waitFor({ state: 'visible' });
    const hero = page.locator('section.cl-hero');
    await expect(hero).toHaveScreenshot('cinematic-hero-desktop.png', {
      maxDiffPixelRatio: 0.03,
      mask: [
        page.locator('.cl-sub'),    // typed text animates
        page.locator('.cl-mesh'),   // animated mesh background
      ],
    });
  });

  test('press page hero at 1280×800', async ({ anonPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/press');
    await page.waitForLoadState('networkidle');
    const hero = page.locator('.press-hero');
    await expect(hero).toBeVisible();
    await expect(hero).toHaveScreenshot('press-hero-desktop.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});
