/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the AI
 * Endpoints registry fetch degrades to a calm error card + Retry, never a crash.
 * Extends the error-injection pattern (see audit-error-state.spec.ts) to `/admin/ai-endpoints`.
 *
 * `ai-endpoints.component.ts`: `@else if (loadError())` → `<app-error-card
 * data-testid="ai-endpoints-load-error" (retry)="reload()">`. Org-scoped, no flag gate.
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

test.describe('Admin · AI Endpoints error-state resilience (P0-ADMIN)', () => {
  test('a 500 on /api/ai-endpoints shows a calm error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      // The registry list is site-scoped: GET /api/sites/:id/ai-endpoints (exclude /:eid detail).
      if (/\/api\/sites\/[^/]+\/ai-endpoints(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/ai-endpoints**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/ai-endpoints', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="ai-endpoints-load-error"]');
    await expect(card, 'the AI-endpoints error card renders on a load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the ai-endpoints request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/ai-endpoints-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
