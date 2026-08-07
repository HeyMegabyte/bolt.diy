/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — GRACEFUL-DEGRADATION resilience: when the
 * Billing entitlements endpoint fails, the panel DERIVES entitlements from the loaded plan
 * (board 06e hardening) rather than blanking. This locks in that fix — a 500 on
 * `/api/billing/entitlements` must NOT leave the Entitlements panel empty or crash billing.
 *
 * Injection: `setupRealDataPage` real-passthrough, then a `page.route` that 500s ONLY
 * `/api/billing/entitlements` (the plan/subscription fetch still succeeds, so `plan()` is
 * known → entitlements derive from it). e2e-test-org is Free → derived seats 1 / domains 0.
 * Org-scoped, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./billing-populated-interactions.spec.ts}
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

test.describe('Admin · Billing entitlements graceful degradation (P0-ADMIN)', () => {
  test('a 500 on /api/billing/entitlements derives from the plan (no blank panel, no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    // Force ONLY the entitlements fetch to fail — the plan (subscription) still loads, so the
    // component can derive entitlements from it (the 06e fallback under test).
    await page.route('**/api/billing/entitlements**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' }),
    );
    await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });

    await page.locator('[data-testid="subscription-plan"]').waitFor({ state: 'visible', timeout: 15000 });

    // Entitlements DERIVE from the plan on the 500 — the panel stays populated, never blanks.
    // (Every value shown here MUST be derived: the real endpoint returned 500.)
    const seats = page.locator('[data-testid="entitlement-seats"]');
    await expect(seats, 'the seats entitlement renders (derived), not a blank panel').toBeVisible({ timeout: 10000 });
    await expect(seats, 'derived seats is a real number despite the 500').toHaveText(/\d/);
    await expect(
      page.locator('[data-testid="entitlement-custom_domains"]'),
      'the custom-domains entitlement renders (derived)',
    ).toBeVisible();

    // A section 500 must NEVER crash the billing boundary.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a 500 must not crash billing').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/billing-error-degrade.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
