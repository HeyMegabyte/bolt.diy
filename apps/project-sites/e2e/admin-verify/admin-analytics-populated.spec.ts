/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — POPULATED-RENDER for the analytics tabs. Each of the
 * three per-site analytics views (`/admin/analytics?tab=forms|visitor|sections`) reads its
 * response DIRECTLY into `data()` (no wrapper). This stubs a NON-empty response and asserts:
 *   1. the populated rows render (`[data-testid="<x>-rows"] li` / `-stages li`) AND the section's
 *      empty testid is ABSENT → proves the FE reads the correct fields (the populated counterpart
 *      to `form-analytics-empty-state` / `visitor-funnel-empty-state` / `section-attribution-empty-state`);
 *   2. a hostile label (`<img onerror>` + unicode) renders inert — `window.__xssHit` stays 0
 *      (every one of these templates is `{{ }}`-interpolation, innerHTML-free);
 *   3. no crash.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./form-analytics-empty-state.spec.ts}
 * @see {@link ./admin-populated-render-xss.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const XSS = '<img src=x onerror="window.__xssHit=1">日本語 🎉';

interface AnalyticsCase {
  readonly name: string;
  readonly route: string;
  readonly glob: string;
  readonly body: string; // a populated response with one hostile-labelled row
  readonly populatedSelector: string;
  readonly emptyTestid: string;
}

const CASES: readonly AnalyticsCase[] = [
  {
    name: 'form-analytics',
    route: '/admin/analytics?tab=forms',
    glob: '**/api/sites/*/analytics/forms**',
    body: JSON.stringify({
      siteId: 'e2e',
      windowDays: 30,
      forms: [
        { form: 'contact', starts: 100, submits: 75, completionRate: 75, abandoned: 25 },
        { form: XSS, starts: 10, submits: 5, completionRate: 50, abandoned: 5 },
      ],
      generatedAt: '2026-08-07T12:00:00Z',
    }),
    populatedSelector: '[data-testid="form-analytics-rows"] li',
    emptyTestid: 'form-analytics-empty',
  },
  {
    name: 'visitor-funnel',
    route: '/admin/analytics?tab=visitor',
    glob: '**/api/sites/*/analytics/funnel**',
    body: JSON.stringify({
      siteId: 'e2e',
      windowDays: 30,
      stages: [
        { key: 'landing', label: 'Landing', sessions: 500, percentOfLanding: 100 },
        { key: 'engaged', label: XSS, sessions: 250, percentOfLanding: 50 },
      ],
      generatedAt: '2026-08-07T12:00:00Z',
    }),
    populatedSelector: '[data-testid="visitor-funnel-stages"] li',
    emptyTestid: 'visitor-funnel-empty',
  },
  {
    name: 'section-attribution',
    route: '/admin/analytics?tab=sections',
    glob: '**/api/sites/*/analytics/sections**',
    body: JSON.stringify({
      siteId: 'e2e',
      windowDays: 30,
      totalConversions: 42,
      sections: [
        { section: 'hero', count: 15, percent: 36, calls: 10, directions: 4, emails: 1 },
        { section: XSS, count: 5, percent: 12, calls: 3, directions: 1, emails: 1 },
      ],
      generatedAt: '2026-08-07T12:00:00Z',
    }),
    populatedSelector: '[data-testid="section-attribution-rows"] li',
    emptyTestid: 'section-attribution-empty',
  },
];

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('Admin · analytics populated-render + XSS (P0-ADMIN)', () => {
  for (const c of CASES) {
    test(`${c.name}: a populated response renders rows (not empty) + hostile label is inert`, async ({ page }) => {
      test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
      const errors = attachConsole(page);
      let hadDialog = false;
      page.on('dialog', (d) => {
        hadDialog = true;
        d.dismiss().catch(() => {});
      });

      await setupRealDataPage(page, { passthrough: /\/api\// });
      await page.route(c.glob, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: c.body }),
      );
      await page.goto(c.route, { waitUntil: 'domcontentloaded' });

      // 1. Populated rows render (correct fields read) AND the empty state is NOT shown.
      await expect(
        page.locator(c.populatedSelector).first(),
        `${c.name}: the populated rows render on a non-empty response`,
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.locator(`[data-testid="${c.emptyTestid}"]`),
        `${c.name}: the empty state is absent when data is present`,
      ).toHaveCount(0);

      // 2. Hostile label rendered inert.
      const xssHit = await page.evaluate(() => (window as unknown as { __xssHit?: number }).__xssHit ?? 0);
      expect(xssHit, `${c.name}: the injected onerror did NOT execute`).toBe(0);
      expect(hadDialog, `${c.name}: no alert dialog from the injected label`).toBe(false);

      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      expect(bodyText.includes('ran into a problem'), `${c.name}: a populated response must not crash`).toBe(false);

      await page.screenshot({ path: `e2e/screenshots/admin-verify/analytics-populated-${c.name}.png` });
      expect(errors, `${c.name}: no console errors — saw ${errors.join(' | ')}`).toEqual([]);
    });
  }
});
