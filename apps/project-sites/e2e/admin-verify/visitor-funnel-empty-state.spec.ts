/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: the Visitor Funnel view (Visitor
 * tab of `/admin/analytics`) renders the honest "No visitor sessions yet" state when a site has
 * zero sessions — not a crash, not a fake funnel.
 *
 * Injection: `/api/sites/:siteId/analytics/funnel` → a real VisitorFunnel object with an empty
 * `stages` array (read DIRECTLY into `data()`, `data.set(d)`). `visitor-funnel.component`:
 * `@if (!data() || (data()!.stages[0]?.sessions ?? 0) === 0)` → `data-testid="visitor-funnel-empty"`.
 * Reached via `?tab=visitor`; site-scoped; auto-load on selected-site change.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./form-analytics-empty-state.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

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

test.describe('Admin · Visitor Funnel empty-state honesty (P0-ADMIN)', () => {
  test('zero sessions renders the honest empty state (no crash, no fake funnel)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/analytics/funnel**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"siteId":"e2e","windowDays":7,"stages":[],"generatedAt":"2026-08-07T00:00:00Z"}',
      }),
    );
    await page.goto('/admin/analytics?tab=visitor', { waitUntil: 'domcontentloaded' });

    await expect(
      page.locator('[data-testid="visitor-funnel-empty"]'),
      'the visitor-funnel empty state renders on zero sessions',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty funnel must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/visitor-funnel-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
