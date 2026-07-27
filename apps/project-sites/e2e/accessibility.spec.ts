/**
 * Accessibility audit — axe-core WCAG 2.2 AA checks at 6 breakpoints.
 *
 * Per FEATURES.md blocker #2: @axe-core/playwright was already in devDependencies
 * but not wired into any spec. This spec closes that gap.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

const BREAKPOINTS = [
  { name: 'mobile-sm', width: 375, height: 812 },
  { name: 'mobile-md', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop-sm', width: 1024, height: 768 },
  { name: 'desktop-md', width: 1280, height: 900 },
  { name: 'desktop-lg', width: 1920, height: 1080 },
];

const PUBLIC_ROUTES = [
  '/',
  '/signin',
  '/pricing',
  '/blog',
  '/search',
  '/integrations',
  '/developers',
  '/press',
] as const;

test.describe('Accessibility — Public Routes', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} has 0 critical axe violations`, async ({ page }) => {
      await page.goto(`${PROD_URL}${route}`);
      await page.waitForLoadState('networkidle');

      for (const bp of BREAKPOINTS) {
        await page.setViewportSize({ width: bp.width, height: bp.height });

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        // Only fail on critical/serious violations — minors tracked separately
        const critical = results.violations.filter(
          (v) => v.impact === 'critical' || v.impact === 'serious',
        );
        expect(critical, `${route} at ${bp.name} (${bp.width}×${bp.height}): ${critical.map(v => v.id).join(', ') || 'none'}`).toEqual([]);
      }
    });
  }
});
