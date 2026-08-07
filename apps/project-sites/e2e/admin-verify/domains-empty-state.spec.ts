/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: when a site has no connected
 * hostnames, `/admin/domains` renders the honest "No connected domains" empty state — never a
 * crash or a fake "re-provision" prompt for a domain the user already owns (the component
 * explicitly guards against a fetch-error masquerading as this empty). Complements
 * `domains-error-state.spec.ts` (500 → error card).
 *
 * Injection: 200 `{data:[]}` for `/api/sites/:id/hostnames`. `domains.component.ts`: `@else if
 * (hostnames().length === 0)` → `<app-empty-state title="No connected domains">` (no section
 * testid → matched by title). Site-scoped, no flag gate.
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
      !/Failed to load resource|net::ERR|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('Admin · Domains empty-state honesty (P0-ADMIN)', () => {
  test('a site with no hostnames renders the honest "No connected domains" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/hostnames**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    );
    await page.goto('/admin/domains', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText(/no connected domains/i),
      'the honest empty state renders on an empty hostname list',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty store must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/domains-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
