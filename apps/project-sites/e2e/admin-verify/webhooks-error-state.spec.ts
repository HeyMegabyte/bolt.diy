/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the webhooks
 * list fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/webhooks` (operates on the selected site).
 *
 * `webhooks.component.ts`: `@else if (error())` → `<app-error-card data-testid="webhooks-error"
 * (retry)="load()">`. List endpoint `GET /api/sites/:id/webhooks` (line 280, `{silent:true}`);
 * `load()` also fetches `/webhooks/deliveries`, both covered by the wildcard 500. The count regex
 * targets the LIST fetch only (excludes `/webhooks/deliveries`). Site-scoped, no flag gate.
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

test.describe('Admin · Webhooks error-state resilience (P0-ADMIN)', () => {
  test('a 500 on the webhooks list shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/webhooks(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/webhooks**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/webhooks', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="webhooks-error"]');
    await expect(card, 'the webhooks error card renders on a list load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the webhooks list request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/webhooks-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
