/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: the Form Analytics view (Forms tab
 * of `/admin/analytics`) renders the honest "No form activity yet" state when a site has zero
 * tracked form events — not a crash, not a fake chart.
 *
 * Injection: `/api/sites/:siteId/analytics/forms` → a real FormAnalytics object with an empty
 * `forms` array (read DIRECTLY into `data()` — no wrapper, `data.set(d)`). `form-analytics.component`:
 * `@if (!data() || data()!.forms.length === 0)` → `data-testid="form-analytics-empty"`. Reached via
 * `?tab=forms`; site-scoped; auto-load on selected-site change.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./section-attribution-empty-state.spec.ts}
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

test.describe('Admin · Form Analytics empty-state honesty (P0-ADMIN)', () => {
  test('zero form activity renders the honest empty state (no crash, no fake chart)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/analytics/forms**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"siteId":"e2e","windowDays":7,"forms":[],"generatedAt":"2026-08-07T00:00:00Z"}',
      }),
    );
    await page.goto('/admin/analytics?tab=forms', { waitUntil: 'domcontentloaded' });

    await expect(
      page.locator('[data-testid="form-analytics-empty"]'),
      'the form-analytics empty state renders on zero form activity',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty analytics must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/form-analytics-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
