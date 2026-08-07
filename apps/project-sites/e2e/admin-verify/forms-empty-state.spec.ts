/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: when the form-submissions store
 * is truly empty, `/admin/forms` renders the honest "No submissions yet" empty state — not a
 * crash, not a blank, not fabricated rows. Complements `forms-error-state.spec.ts` (500 → error
 * card) and the populated sweeps: together they prove the section renders correctly in every
 * data state. CLAUDE.md mandates ≥1 E2E per empty state.
 *
 * Injection: `setupRealDataPage` real-passthrough, then a `page.route` that returns 200
 * `{data:[]}` for the submissions fetch (the exact key the FE reads). `forms.component.ts`:
 * `@else if (submissions().length === 0)` → `<div data-testid="forms-empty">No submissions yet</div>`.
 * Site-scoped (operates on the selected site), no flag gate.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./forms-error-state.spec.ts}
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

test.describe('Admin · Forms empty-state honesty (P0-ADMIN)', () => {
  test('an empty submissions store renders the honest "No submissions yet" state (no crash, no rows)', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    await page.route('**/api/sites/*/form-submissions**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }),
    );
    await page.goto('/admin/forms', { waitUntil: 'domcontentloaded' });

    const empty = page.locator('[data-testid="forms-empty"]');
    await expect(empty, 'the honest empty state renders on an empty store').toBeVisible({ timeout: 15000 });
    await expect(empty, 'the empty copy is honest').toContainText(/no submissions yet/i);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty store must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/forms-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
