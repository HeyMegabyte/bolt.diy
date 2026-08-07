/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the social-analytics
 * aggregate fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern to the Social tab of `/admin/analytics` (`?tab=social`).
 *
 * `social-analytics.component.ts`: `@if (error())` → `<app-error-card title="Couldn't load social
 * analytics" (retry)="reload()">` (no section data-testid → matched by title on the shared inner
 * `[data-testid="error-card"]`). `ngOnInit` calls `load()` (`GET /api/social/analytics/aggregate`)
 * → AUTO-LOAD when the tab is active. Org-scoped.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./billing-error-state.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

function attachConsole(page: Page): string[] {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      !/Failed to load resource|net::ERR|status of 500|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('Admin · Social Analytics error-state resilience (P0-ADMIN)', () => {
  test('a 500 on the social-analytics aggregate shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/social\/analytics\/aggregate(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/social/analytics/aggregate**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/analytics?tab=social', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="error-card"]').filter({ hasText: /couldn.t load social analytics/i });
    await expect(card, 'the social-analytics error card renders on a load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the social-analytics request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/social-analytics-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
