/**
 * Accessibility audit — axe-core WCAG 2.2 AA checks at 6 breakpoints.
 *
 * Per FEATURES.md blocker #2: @axe-core/playwright was already in devDependencies
 * but not wired into any spec. This spec closes that gap.
 *
 * Readiness contract: `waitForLoadState('networkidle')` NEVER settles on this app
 * (PostHog beacons + analytics keep the network busy) — every route timed out on
 * it. Each route now waits for `domcontentloaded` plus its own stable landmark
 * (top-of-page testid or the route component's H1, grepped from the Angular
 * route components in frontend/src/app/pages/) before axe runs.
 *
 * Gate: CRITICAL-impact violations only, via the shared checkA11y helper
 * (e2e/helpers/a11y.ts). Serious/moderate/minor findings are logged by the
 * helper as advisory for the a11y sweep backlog — Brian directive 2026-07-30:
 * a11y is advisory except critical. Pass `{ exclude }` only for cited vendored
 * third-party widgets, never first-party markup.
 */
import { test } from '@playwright/test';
import { checkA11y } from './helpers/a11y.js';

const PROD_URL = process.env.PROD_URL ?? 'https://projectsites.dev';

const BREAKPOINTS = [
  { name: 'mobile-sm', width: 375, height: 812 },
  { name: 'mobile-md', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop-sm', width: 1024, height: 768 },
  { name: 'desktop-md', width: 1280, height: 900 },
  { name: 'desktop-lg', width: 1920, height: 1080 },
];

/**
 * Route → shell-ready landmark. Selectors verified against the Angular route
 * components (app.routes.ts loadComponent targets):
 * - `/`        → hero H1 testid   (pages/homepage/homepage.component.html)
 * - `/signin`  → sign-in page div (pages/auth/sign-in.component.ts)
 * - others     → the route component tag + its first H1
 */
const PUBLIC_ROUTES: ReadonlyArray<{ path: string; ready: string }> = [
  { path: '/', ready: '[data-testid="hero-headline"]' },
  { path: '/signin', ready: '[data-testid="sign-in-page"]' },
  { path: '/pricing', ready: 'app-pricing h1' },
  { path: '/blog', ready: 'app-blog-list h1' },
  { path: '/search', ready: 'app-search h1' },
  { path: '/integrations', ready: 'app-integrations h1' },
  { path: '/developers', ready: 'app-developers h1' },
  { path: '/press', ready: 'app-press h1' },
];

test.describe('Accessibility — Public Routes', () => {
  for (const { path: route, ready } of PUBLIC_ROUTES) {
    test(`${route} has 0 critical axe violations`, async ({ page }) => {
      // 6 breakpoints × one axe pass each doesn't fit the 30s default budget.
      test.setTimeout(120_000);

      await page.goto(`${PROD_URL}${route}`, { waitUntil: 'domcontentloaded' });
      // Explicit shell-ready wait — the SPA shell 200s instantly, but axe must
      // not run against an empty <app-root> mid-hydration.
      // 35s (was 20s): public-route hydration under 2-concurrent CI load runs
      // 15-25s, so 20s flaked (shard-1 render-timeout cluster). The routes DO
      // render (live site + homepage prove it) — a settle-wait fix per
      // prod-e2e-ci-flakes-are-environmental, not hiding a bug.
      await page.locator(ready).first().waitFor({ state: 'visible', timeout: 35_000 });

      for (const bp of BREAKPOINTS) {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await checkA11y(page, `${route} at ${bp.name} (${bp.width}×${bp.height})`);
      }
    });
  }
});
