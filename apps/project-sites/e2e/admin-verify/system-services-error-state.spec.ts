/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the service-catalog
 * fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/system-services` (System Admin operator layer).
 *
 * `system-services.component.ts`: `@else if (loadError())` → `<app-error-card title="Service
 * catalog unavailable" (retry)="load()">` (no section-level data-testid → matched by its title +
 * the shared `.ec-retry`). Endpoint `GET /api/super-admin/services` (line 143). The realdata helper
 * seeds `ps_session.identifier=brian@megabyte.space`, so the client sys-admin guard admits brian
 * via the allowlist and the section mounts. Org-scoped, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./ai-endpoints-error-state.spec.ts}
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

test.describe('Admin · System Services error-state resilience (P0-ADMIN)', () => {
  test('a 500 on /api/super-admin/services shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/super-admin\/services(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/super-admin/services**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/system-services', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText(/service catalog unavailable/i),
      'the service-catalog error card renders on a load failure',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await page.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the service-catalog request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/system-services-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
