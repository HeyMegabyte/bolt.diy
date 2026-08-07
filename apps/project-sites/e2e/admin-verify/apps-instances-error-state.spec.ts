/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the installed-
 * app instances fetch degrades to a calm error card + Retry (never a crash), when there is
 * no cached list. Extends the error-injection pattern to `/admin/apps/instances`.
 *
 * `apps-instances.component.ts`: `@else if (loadError() && instances().length === 0)` →
 * `<app-error-card title="Couldn't load your apps" (retry)="load()">` (no section testid →
 * matched by its title + the shared `.ec-retry`). Org-scoped (`GET /api/apps/instances`),
 * no flag gate. A fresh browser context has no cached instances, so the 500 surfaces the card.
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

test.describe('Admin · Apps Instances error-state resilience (P0-ADMIN)', () => {
  test('a 500 on /api/apps/instances shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/apps\/instances(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/apps/instances**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/apps/instances', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText(/couldn.t load your apps/i), 'the apps error card renders on a load failure').toBeVisible(
      { timeout: 15000 },
    );
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await page.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the instances request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/apps-instances-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
