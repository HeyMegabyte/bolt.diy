/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — ERROR-STATE resilience: a 500 on the personal
 * API-keys fetch degrades to a calm error card + Retry, isolated to the keys panel — the rest
 * of the user-settings page (theme, display name) stays live and nothing crashes.
 * Extends the error-injection pattern to `/admin/user` (the AdminUserSettingsComponent).
 *
 * `user-settings.component.ts`: the keys panel wraps `<app-error-card
 * data-testid="user-settings-keys-error" (retry)="loadApiKeys()">`. Endpoint `GET
 * /api/admin/api-keys` (line 1240). Only that fetch is 500'd (passthrough keeps the rest real),
 * so the failure is scoped to the keys card. Org-scoped, no flag gate.
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
      !/Failed to load resource|net::ERR|status of 500|Access is denied for this document|localStorage/i.test(m.text())
    )
      errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test.describe('Admin · User Settings (API keys) error-state resilience (P0-ADMIN)', () => {
  test('a 500 on /api/admin/api-keys shows a scoped error card + Retry (no crash), and Retry re-fetches', async ({
    page,
  }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    const errors = attachConsole(page);
    let reqs = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && /\/api\/admin\/api-keys(\?|$)/.test(r.url())) reqs++;
    });

    await setupRealDataPage(page, { passthrough: /\/api\// });
    // Fail ONLY the keys GET — the rest of user-settings (theme, display name) stays real.
    await page.route('**/api/admin/api-keys**', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"forced-e2e"}' });
      return route.fallback();
    });
    await page.goto('/admin/user', { waitUntil: 'domcontentloaded' });

    const card = page.locator('[data-testid="user-settings-keys-error"]');
    await expect(card, 'the keys error card renders on a keys load failure').toBeVisible({ timeout: 15000 });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes('ran into a problem'), 'a scoped 500 must not crash the settings boundary').toBe(false);

    const before = reqs;
    await card.locator('.ec-retry').click();
    await page.waitForTimeout(1000);
    expect(reqs, 'clicking Retry re-fires the api-keys request').toBeGreaterThan(before);

    await page.screenshot({ path: 'e2e/screenshots/admin-verify/user-settings-keys-error-state.png' });
    expect(errors, `no unexpected console errors beyond the forced 500 — saw ${errors.join(' | ')}`).toEqual([]);
  });
});
