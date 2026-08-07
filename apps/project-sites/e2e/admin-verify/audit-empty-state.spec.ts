/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: when the audit-log store is
 * truly empty, `/admin/audit` renders the honest "No audit events yet" empty state — not a
 * crash, not a blank grid. Complements `audit-error-state.spec.ts` (500 → error card).
 *
 * Injection: 200 `{data:[]}` for `/api/audit-logs`. `audit.component.ts`: `@else if (!loading()
 * && displayRows().length === 0)` → `<div data-testid="audit-empty">No audit events yet</div>`.
 * Org-scoped, no flag gate.
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
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('Admin · Audit empty-state honesty (P0-ADMIN)', () => {
  test('an empty audit store renders the honest "No audit events yet" state (no crash, no grid)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/audit-logs**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    );
    await page.goto('/admin/audit', { waitUntil: 'domcontentloaded' });

    const empty = page.locator('[data-testid="audit-empty"]');
    await expect(empty, 'the honest empty state renders on an empty store').toBeVisible({ timeout: 15000 });
    await expect(empty, 'the empty copy is honest').toContainText(/no audit events yet/i);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty store must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/audit-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
