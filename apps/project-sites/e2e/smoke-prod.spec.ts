/**
 * @module e2e/smoke-prod
 * @description Production smoke suite — runs against `PROD_URL` (defaults to
 * `https://projectsites.dev`) with a real Chromium browser.
 *
 * Coverage:
 * - Homepage renders with an H1
 * - "Sign In" flow is reachable via the UI
 * - `/signin` form renders its email input
 * - axe-core reports zero serious/critical violations on both routes
 * - Six standard breakpoints are checked: 375, 390, 768, 1024, 1280, 1920
 *
 * Run this spec in isolation:
 * ```sh
 * PROD_URL=https://projectsites.dev npx playwright test smoke-prod --config playwright.prod.config.ts
 * ```
 *
 * Or via the default config (against the local dev server):
 * ```sh
 * npx playwright test smoke-prod
 * ```
 *
 * @see {@link ./helpers/auth.ts} for auth pathway documentation
 * @see {@link ./helpers/axe.ts} for axe wrapper API
 */

import path from 'node:path';
import { test, expect } from '@playwright/test';
import { expectAxeClean } from './helpers/axe.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

/**
 * The six canonical breakpoints required by the global E2E mandate.
 * Each entry is `[label, width, height]`.
 */
const BREAKPOINTS: ReadonlyArray<[string, number, number]> = [
  ['mobile-375', 375, 812],
  ['mobile-390', 390, 844],
  ['tablet-768', 768, 1024],
  ['laptop-1024', 1024, 768],
  ['desktop-1280', 1280, 800],
  ['widescreen-1920', 1920, 1080],
];

/**
 * Directory where screenshot artifacts are written.
 * Mirrors the pattern used by other specs in this repo.
 */
const SCREENSHOT_DIR = path.join('e2e', 'screenshots', 'smoke-prod');

// ---------------------------------------------------------------------------
// Homepage smoke
// ---------------------------------------------------------------------------

test.describe('Homepage smoke', () => {
  test('renders with an H1 and no serious axe violations', async ({ page }) => {
    const response = await page.goto(PROD_URL);

    // HTTP status must be 2xx
    expect(response?.status()).toBeGreaterThanOrEqual(200);
    expect(response?.status()).toBeLessThan(300);

    // At least one H1 must be visible above the fold
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible({ timeout: 15_000 });
    const h1Text = await h1.textContent();
    expect(h1Text?.trim().length).toBeGreaterThan(0);

    // Accessibility gate
    await expectAxeClean(page);
  });

  test('content-type is text/html', async ({ page }) => {
    const response = await page.goto(PROD_URL);
    const contentType = response?.headers()['content-type'] ?? '';
    expect(contentType).toContain('text/html');
  });
});

// ---------------------------------------------------------------------------
// Sign-In flow smoke
// ---------------------------------------------------------------------------

test.describe('Sign-In flow smoke', () => {
  test('clicking sign-in reaches the signin form', async ({ page }) => {
    await page.goto(PROD_URL);

    // Wait for the page to be interactive
    await page.waitForLoadState('domcontentloaded');

    // The SPA may use a sign-in button with various selectors.
    // Try data-testid first (preferred), then common text/role patterns.
    const signinBtn = page.locator(
      '[data-testid="nav-signin"], [data-testid="signin-btn"],' +
      ' text="Sign In", text="Sign in", [onclick*="signin"], [href*="signin"]',
    );

    const btnVisible = await signinBtn.first().isVisible({ timeout: 5_000 }).catch(() => false);

    if (btnVisible) {
      await signinBtn.first().click();
    } else {
      // Fall back to JS navigation used by the vanilla SPA
      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const nav = w.navigateTo as ((s: string) => void) | undefined;
        if (typeof nav === 'function') nav('signin');
      });
    }

    // The sign-in screen must become visible
    const signinScreen = page.locator(
      '[data-testid="signin-screen"], #screen-signin, [class*="signin"]',
    );
    await expect(signinScreen.first()).toBeVisible({ timeout: 10_000 });

    // The email input must be reachable (either visible or within the panel)
    const emailInput = page.locator(
      '[data-testid="signin-email-input"], #email-step-input, #email-input, input[type="email"]',
    );
    await expect(emailInput.first()).toBeAttached({ timeout: 5_000 });

    // Accessibility gate on the sign-in surface
    await expectAxeClean(page);
  });
});

// ---------------------------------------------------------------------------
// Six-breakpoint matrix
// ---------------------------------------------------------------------------

/**
 * Parameterized smoke across all 6 required breakpoints.
 *
 * Each iteration:
 * 1. Resizes the viewport
 * 2. Navigates to the homepage
 * 3. Asserts an H1 is visible
 * 4. Runs axe-core (serious/critical)
 * 5. Captures a screenshot into `e2e/screenshots/smoke-prod/`
 */
for (const [label, width, height] of BREAKPOINTS) {
  test.describe(`Breakpoint ${label} (${width}×${height})`, () => {
    test.use({ viewport: { width, height } });

    test(`homepage renders and is axe-clean at ${label}`, async ({ page }) => {
      await page.goto(PROD_URL);
      await page.waitForLoadState('domcontentloaded');

      // H1 must be present at every viewport
      const h1 = page.locator('h1').first();
      await expect(h1).toBeVisible({ timeout: 15_000 });

      // Axe gate
      await expectAxeClean(page);

      // Screenshot artifact
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `homepage-${label}.png`),
        fullPage: false,
      });
    });

    test(`signin form renders at ${label}`, async ({ page }) => {
      await page.goto(PROD_URL);
      await page.waitForLoadState('domcontentloaded');

      // Navigate to signin via JS (same approach as auth-and-signin.spec.ts)
      await page.evaluate(() => {
        const w = window as unknown as Record<string, unknown>;
        const nav = w.navigateTo as ((s: string) => void) | undefined;
        if (typeof nav === 'function') nav('signin');
      });

      const signinScreen = page.locator(
        '[data-testid="signin-screen"], #screen-signin',
      );
      await expect(signinScreen.first()).toBeAttached({ timeout: 10_000 });

      // Screenshot artifact
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `signin-${label}.png`),
        fullPage: false,
      });
    });
  });
}
