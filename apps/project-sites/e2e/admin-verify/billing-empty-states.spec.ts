/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: the `/admin/billing` Usage tab
 * renders the honest "No spend alerts yet" state when there are no alerts — not a crash.
 * Complements `billing-error-state.spec.ts` + `billing-populated-interactions`.
 *
 * Injection: `/api/billing/spend-alerts` → `{data:[]}` (the FE reads `r.data`) drives
 * `billing-alerts-empty` under `@if (activeTab() === 'usage')`, reached via `?tab=usage`.
 * (The sibling `billing-caps-empty`/`billing-costs-empty` are NOT asserted here: the site-costs
 * loader zero-fills one row per site (`effective = rows ?? zeroFillFromSites()`), so those empties
 * only appear for an org with ZERO sites — untestable for the seeded org, which has sites.)
 * Org-scoped, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./billing-error-state.spec.ts}
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

test.describe('Admin · Billing Usage empty-state honesty (P0-ADMIN)', () => {
  test('an empty spend-alerts store renders the honest "No spend alerts yet" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/billing/spend-alerts**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    );
    await page.goto('/admin/billing?tab=usage', { waitUntil: 'domcontentloaded' });

    const empty = page.locator('[data-testid="billing-alerts-empty"]');
    await expect(empty, 'the spend-alerts empty state renders').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty store must not crash billing').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/billing-empty-states.png' });
    expect(errors, `no console errors on honest empty states — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
