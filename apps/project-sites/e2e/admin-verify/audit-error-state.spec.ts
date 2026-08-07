/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: when the Audit Log's
 * data endpoint fails, the section degrades to a calm error card + a working Retry — it
 * NEVER crashes the boundary or blanks. `audit-interactions.spec.ts` asserts `audit-error`
 * is ABSENT on a healthy load; THIS forces a 500 and verifies the failure UX (the mandate's
 * "Errors as UX" — every error state has ≥1 E2E).
 *
 * Injection: `setupRealDataPage` real-passthrough for the shell, then a `page.route` that
 * 500s ONLY `/api/audit-logs` (registered after the helper's catch-all → Playwright runs the
 * last-matching route first, so it wins). Org-scoped (no site id), no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./audit-interactions.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import type { Page } from '@playwright/test';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

/** Console errors EXCEPT the forced 500's resource-load line (that failure is intentional). */
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

test.describe('Admin · Audit error-state resilience (P0-ADMIN)', () => {
  test('a 500 on /api/audit-logs shows a calm error card + Retry (no crash), and Retry re-fetches', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let auditReqs = 0;
    page.on('request', (r) => {
      if (/\/api\/audit-logs/.test(r.url())) auditReqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    // Force ONLY the audit fetch to fail — registered AFTER the helper's catch-all so it wins.
    await page.route('**/api/audit-logs**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":{"message":"forced-e2e","request_id":"e2e-forced"}}',
      }),
    );
    await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="audit-error"]');
    await expect(card, 'the audit error card renders on a load failure').toBeVisible({ timeout: 15000 });
    await expect(card, 'it names the failure calmly (not a raw stack)').toContainText(/couldn.t load audit events/i);

    // A section 500 must NEVER escalate to the app error boundary / a blank screen.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a section 500 must not crash the boundary').toBe(false);

    // The recovery affordance (Retry) re-fires the request.
    const before = auditReqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(auditReqs, 'clicking Retry re-fires the audit request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/audit-error-state.png' });
    // The forced 500's resource-load console error is filtered; assert no OTHER console errors.
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
