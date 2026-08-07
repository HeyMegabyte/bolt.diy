/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the AI-traces
 * (ai-logs) list fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern to `/admin/ai-logs` (operates on the selected site).
 *
 * `ai-logs.component.ts`: `@else if (loadError())` → `<div class="card" role="alert"
 * data-testid="ai-logs-load-error">` with a `<button data-testid="ai-logs-retry"
 * (click)="reload()">`. List endpoint `GET /api/sites/:id/ai-logs` (line 1268, `{silent:true}`
 * so no toast). Count regex excludes the `/ai-logs/:id` detail fetch. Site-scoped, no flag gate.
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

test.describe('Admin · AI Logs error-state resilience (P0-ADMIN)', () => {
  test('a 500 on the ai-logs list shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (/\/api\/sites\/[^/]+\/ai-logs(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/ai-logs**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/ai-logs', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="ai-logs-load-error"]');
    await expect(card, 'the ai-logs error card renders on a list load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await page.locator('[data-testid="ai-logs-retry"]').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the ai-logs list request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/ai-logs-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
