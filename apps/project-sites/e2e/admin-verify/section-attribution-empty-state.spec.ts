/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: the Section Attribution view
 * (Sections tab of `/admin/analytics`) renders an honest "No call or directions conversions yet"
 * state when a site has zero attributed conversions — not a crash, not a fake chart.
 *
 * Injection: `/api/sites/:siteId/analytics/sections` → `{totalConversions:0}` (the FE reads the
 * response DIRECTLY into `data()` — no `data` wrapper). `section-attribution.component.ts`:
 * `@else if (!data() || data()!.totalConversions === 0)` → `data-testid="section-attribution-empty"`.
 * Reached via `?tab=sections`; site-scoped; auto-load on selected-site change.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./analytics-network-overview.spec.ts}
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

test.describe('Admin · Section Attribution empty-state honesty (P0-ADMIN)', () => {
  test('zero attributed conversions renders the honest empty state (no crash, no fake chart)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    // The response is read directly into data() (no wrapper) — totalConversions:0 → empty.
    await page.route('**/api/sites/*/analytics/sections**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"totalConversions":0,"sections":[]}' }),
    );
    await page.goto('/admin/analytics?tab=sections', { waitUntil: 'domcontentloaded' });

    await expect(
      page.locator('[data-testid="section-attribution-empty"]'),
      'the section-attribution empty state renders on zero conversions',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty attribution must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/section-attribution-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
