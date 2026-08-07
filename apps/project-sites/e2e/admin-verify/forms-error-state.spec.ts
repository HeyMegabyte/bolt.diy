/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the form-
 * submissions fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/forms` (operates on the selected site).
 *
 * `forms.component.ts`: `@else if (loadError() && submissions().length === 0)` →
 * `<app-error-card data-testid="forms-load-error" (retry)="reload()">`. A fresh session has
 * no cached submissions, so a 500 surfaces the error card. No flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./audit-error-state.spec.ts}
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

test.describe('Admin · Forms error-state resilience (P0-ADMIN)', () => {
  test('a 500 on the form-submissions fetch shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/form-submissions/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/form-submissions**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/forms', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="forms-load-error"]');
    await expect(card, 'the forms error card renders on a submissions load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the form-submissions request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/forms-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
