/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — EMPTY-STATE honesty: when a site has no webhook
 * endpoints, `/admin/webhooks` renders the honest "No webhook endpoints" empty state — not a
 * crash. A stubbed 200 `{endpoints:[]}` also proves the flag-disabled path (which triggers on a
 * 404) does not swallow a legitimate empty. Complements `webhooks-error-state.spec.ts`.
 *
 * `webhooks.component.ts`: `@else if (!error() && !flagDisabled() && endpoints().length === 0)`
 * → `<app-empty-state title="No webhook endpoints">` (no section testid → matched by title; the
 * `webhooks-empty` testid is the DIFFERENT no-site state). Response key is `endpoints`.
 * Site-scoped.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./webhooks-error-state.spec.ts}
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

test.describe('Admin · Webhooks empty-state honesty (P0-ADMIN)', () => {
  test('a site with no endpoints renders the honest "No webhook endpoints" state (no crash)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);

    await setupRealDataPage(page, { passthrough: /\/api\// });
    // 200 `{endpoints:[]}` — a legitimate empty, NOT a 404 (which would trip flagDisabled()).
    await page.route('**/api/sites/*/webhooks**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"endpoints":[]}' }),
    );
    await page.goto('/admin/webhooks', { waitUntil: 'domcontentloaded' });

    await expect(
      page.getByText(/no webhook endpoints/i),
      'the honest empty state renders on an empty endpoint list',
    ).toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'an empty store must not crash the boundary').toBe(false);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/webhooks-empty-state.png' });
    expect(errors, `no console errors on an honest empty state — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
