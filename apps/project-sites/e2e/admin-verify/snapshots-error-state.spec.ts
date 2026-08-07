/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the snapshots
 * list fetch degrades to a calm, reassuring error card + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/snapshots` (operates on the selected site).
 *
 * `snapshots.component.ts`: `@else if (snapshotsError())` → a custom `.empty-state`
 * `<div role="alert" data-testid="snapshots-load-error">` with an `<h4>Couldn't load
 * snapshots</h4>` and a `<button data-testid="snapshots-retry" (click)="retryLoadSnapshots()">`
 * (NOT an `<app-error-card>`, so the retry is the section testid, not `.ec-retry`). The
 * list endpoint is `GET /api/sites/:id/snapshots` (line 1665); the count regex excludes the
 * `/snapshots/metrics` enrichment fetch. Site-scoped, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./domains-error-state.spec.ts}
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

test.describe('Admin · Snapshots error-state resilience (P0-ADMIN)', () => {
  test('a 500 on the snapshots list shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      // Count the LIST fetch only — /sites/:id/snapshots — not /snapshots/metrics.
      if (/\/api\/sites\/[^/]+\/snapshots(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/snapshots**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/snapshots', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="snapshots-load-error"]');
    await expect(card, 'the snapshots error card renders on a list load failure').toBeVisible({ timeout: 15000 });
    await expect(card, 'the error card carries the reassuring heading').toContainText(/couldn.t load snapshots/i);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await page.locator('[data-testid="snapshots-retry"]').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the snapshots list request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/snapshots-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
