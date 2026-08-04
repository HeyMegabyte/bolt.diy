/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — System Services (`/admin/system-services`).
 * A SUPER-ADMIN operator section: it calls `/api/super-admin/services`, which 403s for
 * the E2E_API_KEY org (account-expected, NOT a bug — see [[e2e-key-is-not-brians-account]]);
 * brian sees it fully populated. So the org-agnostic assertion is: the section RENDERS
 * (heading + not-404) and shows an access-appropriate state (populated service cards OR
 * a graceful error/retry) — never a crash/blank. Read-only (no mutating actions exist).
 * Enumerated read-only (directive #1).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const goto = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/system-services', { waitUntil: 'domcontentloaded' });
  await page
    .waitForFunction(() => (document.querySelector('main')?.innerText ?? '').trim().length > 120, { timeout: 15000 })
    .catch(() => {});
};

test.describe('Admin · System Services (P0-ADMIN)', () => {
  test('the section renders its heading, not the 404', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    expect(new URL(page.url()).pathname).toBe('/admin/system-services');
    await expect(page.getByText(/system services/i).first(), 'the System Services heading renders').toBeVisible({
      timeout: 8000,
    });
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist")).toBe(false);
  });

  test('it shows an access-appropriate state (populated OR graceful error), never a crash', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await goto(page);
    // The section renders SOME state for the caller's access level — populated cards
    // (super-admin) OR a graceful error/limited view (non-super-admin, whose
    // /api/super-admin/services 403s, account-expected). Org-agnostic invariant:
    // substantial content rendered, never a blank/crash.
    const mainLen = await page.evaluate(() => (document.querySelector('main')?.innerText ?? '').trim().length);
    expect(mainLen, 'system-services rendered content (populated or graceful access state)').toBeGreaterThan(200);

    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const phrase of ['something went wrong', 'application error']) {
      expect(body.includes(phrase), `must not be crashed: "${phrase}"`).toBe(false);
    }
  });
});
