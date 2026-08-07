/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: `/admin/feature-flags` renders the
 * honest "No feature flags registered" state when the registry is empty — not a crash. In prod the
 * registry always has core flags, so the empty is exercised by stubbing BOTH fetches the operator
 * layer merges: the public `/api/feature-flags` AND the super-admin `/api/super-admin/feature-flags`
 * (the FE reads `res.flags` from each and merges into `flags.set(...)`, feature-flags.component
 * lines 914-930). brian passes the `sysAdminGuard` via the seeded identifier, so both fetch.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./feature-flags-search-domain.spec.ts}
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

test.describe('Admin · Feature Flags empty-state honesty (P0-ADMIN)', () => {
  test('an empty registry renders the honest "No feature flags registered" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    // Both the public registry AND the super-admin overrides must be empty for flags() to be [].
    await page.route('**/api/super-admin/feature-flags**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"flags":[]}' }),
    );
    await page.route('**/api/feature-flags**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"flags":[]}' }),
    );
    await page.goto('/admin/feature-flags', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText(/no feature flags registered/i),
      'the honest empty state renders on an empty registry',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty registry must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/feature-flags-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
