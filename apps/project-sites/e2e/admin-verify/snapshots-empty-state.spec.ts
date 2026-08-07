/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: when a site has no snapshots,
 * `/admin/snapshots` renders the honest "No snapshots yet" empty state — not a crash, and NOT a
 * fake empty masking a fetch error (the component explicitly records load failures as the error
 * card instead, guarding against a re-capture prompt for snapshots that are safe). Complements
 * `snapshots-error-state.spec.ts` (500 → error card): together they cover both the empty and the
 * failed states.
 *
 * Injection: 200 `{data:[]}` for `/api/sites/:id/snapshots`. `snapshots.component.ts`:
 * `@else if (snapshots().length === 0)` → `<h4>No snapshots yet</h4>` (no section testid →
 * matched by copy). Site-scoped, no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./snapshots-error-state.spec.ts}
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

test.describe('Admin · Snapshots empty-state honesty (P0-ADMIN)', () => {
  test('a site with no snapshots renders the honest "No snapshots yet" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/snapshots**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    );
    await page.goto('/admin/snapshots', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText(/no snapshots yet/i),
      'the honest empty state renders on an empty snapshot list',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty store must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/snapshots-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
