/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: when no leads have been scanned,
 * `/admin/leads` renders the honest "No leads yet. Run a scan above…" empty state with its
 * first-action affordance — not a crash. The Lead Scanner's value is the CTA to run the first
 * scan, so the empty state must guide, never dead-end.
 *
 * Injection: 200 `{leads:[],count:0}` for `/api/admin/leads` (the FE reads the `leads` key).
 * `leads.component.ts`: `@else if (leads().length === 0)` → `<… data-testid="leads-empty">`.
 * Org-scoped.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./empty-state-first-action.spec.ts}
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

test.describe('Admin · Lead Scanner empty-state honesty (P0-ADMIN)', () => {
  test('an empty leads store renders the honest "No leads yet — run a scan" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/admin/leads**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"leads":[],"count":0}' }),
    );
    await page.goto('/admin/leads', { waitUntil: 'domcontentloaded' });

    const empty = page.locator('[data-testid="leads-empty"]');
    await expect(empty, 'the honest empty state renders on an empty leads store').toBeVisible({ timeout: 15000 });
    await expect(empty, 'the empty copy guides to the first scan').toContainText(/no leads yet|run a scan/i);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty store must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/leads-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
