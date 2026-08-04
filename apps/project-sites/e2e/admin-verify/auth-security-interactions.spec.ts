/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — comprehensive coverage of the Auth
 * Security & Health section (`/admin/auth-security`). It wraps custom-D1 auth
 * endpoints (list-sessions etc. — see [[better-auth-sections-need-custom-d1-endpoints]])
 * so it renders authed. Structural + interaction assertions robust for any org
 * (the E2E_API_KEY org may have less auth history than brian) — every "state"
 * surface is asserted as ONE-OF (loaded | empty | unavailable), never a data-count
 * assumption (see [[admin-verify-e2e-authoring-gotchas]] #5).
 *
 * Contract (auth-security.component.ts): `auth-security-page` · `Security` heading ·
 * `auth-security-metrics` (metric-signins/anomalies/anomaly-rate/actors) OR
 * `auth-security-empty` · `as-sessions` (as-sessions-list | -empty | -unavailable +
 * as-sessions-refresh) · `as-2fa` (as-2fa-enroll → as-2fa-dialog → as-2fa-cancel) ·
 * `auth-suspicious` (rows | -empty) · `auth-security-error` (must NOT show).
 *
 * @see {@link ../helpers/realdata.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const gotoAuthSec = async (page: import('@playwright/test').Page) => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/auth-security', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-testid="auth-security-page"]').waitFor({ state: 'visible', timeout: 15000 });
  // Let the async loads settle off the loading skeleton.
  await page.locator('[data-testid="auth-security-loading"]').waitFor({ state: 'hidden', timeout: 12000 }).catch(() => {});
};

test.describe('Admin · Auth Security & Health interactions (P0-ADMIN)', () => {
  test('the page renders authed (not the 404 / not a load error)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoAuthSec(page);

    expect(new URL(page.url()).pathname).toBe('/admin/auth-security');
    await expect(page.getByText(/^security$/i).first(), 'the Security heading renders').toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="auth-security-error"]'), 'no load error on a healthy load').toHaveCount(0);
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body.includes("admin page doesn't exist"), 'must not be the not-found page').toBe(false);
  });

  test('the security metrics render (or an honest empty state)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoAuthSec(page);

    const metrics = page.locator('[data-testid="auth-security-metrics"]');
    const empty = page.locator('[data-testid="auth-security-empty"]');
    const state = (await metrics.count()) + (await empty.count());
    expect(state, 'metrics or an honest-empty state must render').toBeGreaterThan(0);

    // When metrics render, all four cards are present (sign-ins / anomalies / rate / actors).
    if ((await metrics.count()) > 0) {
      for (const id of ['metric-signins', 'metric-anomalies', 'metric-anomaly-rate', 'metric-actors']) {
        await expect(page.locator(`[data-testid="${id}"]`), `${id} card renders`).toBeVisible({ timeout: 6000 });
      }
    }
  });

  test('the sessions panel renders a state + a refresh control', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoAuthSec(page);

    await expect(page.locator('[data-testid="as-sessions"]'), 'the sessions panel renders').toBeVisible({
      timeout: 8000,
    });
    // One of list / empty / unavailable — all are "working" states.
    const states = page.locator(
      '[data-testid="as-sessions-list"], [data-testid="as-sessions-empty"], [data-testid="as-sessions-unavailable"]',
    );
    await expect(states.first(), 'sessions shows a list / empty / unavailable state').toBeVisible({ timeout: 8000 });
    await expect(page.locator('[data-testid="as-sessions-refresh"]'), 'a refresh control is present').toBeVisible();
  });

  test('the 2FA enroll dialog opens and cancels (modal interaction, non-mutating)', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    await gotoAuthSec(page);

    const enroll = page.locator('[data-testid="as-2fa-enroll"]');
    await expect(enroll, 'the 2FA enroll affordance is present').toBeVisible({ timeout: 8000 });
    await enroll.click();

    const dialog = page.locator('[data-testid="as-2fa-dialog"]');
    await expect(dialog, 'clicking enroll opens the 2FA dialog').toBeVisible({ timeout: 8000 });

    // Cancel closes it (never submit — enrolling 2FA is a real security mutation).
    await page.locator('[data-testid="as-2fa-cancel"]').click();
    await expect(dialog, 'cancel closes the 2FA dialog').toBeHidden({ timeout: 6000 });
  });
});
