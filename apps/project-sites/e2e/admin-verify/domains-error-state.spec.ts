/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the connected-
 * domains (hostnames) fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/domains` (operates on the selected site).
 *
 * `domains.component.ts`: `@else if (hostnamesError())` → `<app-error-card
 * data-testid="hostnames-load-error" (retry)="loadHostnames()">`. The site id is in the
 * path, so the route wildcard covers any selected site. No flag gate.
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

test.describe('Admin · Domains error-state resilience (P0-ADMIN)', () => {
  test('a 500 on the hostnames fetch shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/hostnames/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/hostnames**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="hostnames-load-error"]');
    await expect(card, 'the domains error card renders on a hostnames load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the hostnames request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/domains-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
