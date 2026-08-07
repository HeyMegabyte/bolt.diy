/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: `/admin/auth-security` renders the
 * honest "No authentication events yet" state when the audit store is empty — never a crash or a
 * blank. A security surface must never fabricate rows.
 *
 * Injection: `/api/audit-logs` → `{data:[]}` drives `auth-security-empty`. (The sibling
 * `auth-suspicious-empty` requires a POPULATED-but-non-suspicious audit — it lives in the
 * events-present branch, not the empty branch — and `as-sessions-empty` depends on the Better-Auth
 * `list-sessions` returning a raw array vs the "unavailable" path; both are separate scenarios,
 * covered elsewhere.) Auto-load on `ngOnInit`, default view, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./auth-security-interactions.spec.ts}
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

test.describe('Admin · Auth & Security empty-state honesty (P0-ADMIN)', () => {
  test('an empty audit store renders the honest "No authentication events yet" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/audit-logs**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    );
    await page.goto('/admin/auth-security', { waitUntil: 'domcontentloaded' });

    const empty = page.locator('[data-testid="auth-security-empty"]');
    await expect(empty, 'the auth-events empty state renders').toBeVisible({ timeout: 15000 });
    await expect(empty, 'the copy is honest').toContainText(/no authentication events yet/i);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty store must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/auth-security-empty-state.png' });
    expect(errors, `no console errors on honest empty states — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
