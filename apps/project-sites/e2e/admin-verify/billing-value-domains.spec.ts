/**
 * ADMIN FEATURE VERIFICATION (P0-ADMIN) — VALUE-DOMAIN coverage (directive #3) for
 * the Billing spend-alert form (the credit-caps modal, `/admin/billing`).
 * billing-populated-interactions covers the populated plan/entitlements; THIS drives
 * the alert form's field validation across the value-domain.
 *
 * NON-MUTATING + money-path-safe: it opens the spend-alert modal (Usage tab → "+
 * Create alert") and exercises validation only — it NEVER clicks
 * `billing-spend-alert-submit`, so no alert is ever written.
 *
 * Validators (enumerated read-only, billing.component:2041-2075):
 *  - threshold: error when `<= 0` OR `> 100000` (else valid).
 *  - email: error when non-empty + not a valid address.
 *  - name: error when `> 80` chars (maxlength=80 enforces the boundary).
 *  - `canSaveAlert()` gates `billing-caps-modal-save` on all-present + all-valid.
 *
 * @see {@link ../helpers/realdata.ts}
 * @see {@link ./billing-populated-interactions.spec.ts}
 */
import { test, expect } from '../fixtures.js';
import { setupRealDataPage, realDataAvailable } from '../helpers/realdata.js';

const openAlertModal = async (page: import('@playwright/test').Page): Promise<boolean> => {
  await setupRealDataPage(page, { passthrough: /\/api\// });
  await page.goto('/admin/billing', { waitUntil: 'domcontentloaded' });
  // The Spend Alerts section (and its "+ Create alert" trigger) live under the Usage tab.
  const usageTab = page.locator('[data-testid="billing-tab-usage"]');
  await usageTab.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if ((await usageTab.count()) === 0) return false;
  await usageTab.click();
  const create = page.locator('[data-testid="billing-spend-alert-create"]').first();
  await create.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  if ((await create.count()) === 0) return false;
  await create.click();
  await page
    .locator('[data-testid="billing-spend-alert-threshold"]')
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => {});
  return (await page.locator('[data-testid="billing-spend-alert-threshold"]').count()) > 0;
};

test.describe('Admin · Billing spend-alert — value domain (P0-ADMIN)', () => {
  test('threshold rejects non-positive + over-cap values, accepts an in-range one', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openAlertModal(page)), 'spend-alert modal not available for this org');
    const threshold = page.locator('[data-testid="billing-spend-alert-threshold"]');
    const err = page.locator('#alert-threshold-error');

    for (const bad of ['0', '-5', '100001']) {
      await threshold.fill(bad);
      await expect(err, `threshold "${bad}" is rejected with an inline error`).toBeVisible({ timeout: 4000 });
    }
    // A valid in-range threshold clears the error.
    await threshold.fill('10000');
    await expect(err, 'a valid threshold clears the error').toBeHidden({ timeout: 4000 });
  });

  test('notify email rejects invalid + injection-shaped addresses, accepts a valid one', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openAlertModal(page)), 'spend-alert modal not available for this org');
    const email = page.locator('input[aria-describedby="alert-email-error"]').first();
    const err = page.locator('#alert-email-error');
    await expect(email, 'the notify-email field renders').toBeVisible({ timeout: 6000 });

    for (const bad of ['notanemail', '<script>@x', 'foo bar@baz.com']) {
      await email.fill(bad);
      await email.blur();
      await expect(err, `email "${bad}" is rejected with an inline error`).toBeVisible({ timeout: 4000 });
    }
    await email.fill('alerts@example.com');
    await email.blur();
    await expect(err, 'a valid email clears the error').toBeHidden({ timeout: 4000 });
  });

  test('name enforces the 80-char cap and save gates on a complete valid form', async ({ page }) => {
    test.skip(!realDataAvailable(), 'needs E2E_API_KEY for a real session');
    test.skip(!(await openAlertModal(page)), 'spend-alert modal not available for this org');
    const name = page.locator('[data-testid="billing-spend-alert-name"]');
    const email = page.locator('input[aria-describedby="alert-email-error"]').first();
    const save = page.locator('[data-testid="billing-spend-alert-submit"]');

    // Overlong name is capped by maxlength=80 (never exceeds the boundary).
    await name.fill('x'.repeat(140));
    expect((await name.inputValue()).length, 'name is capped at 80 chars').toBeLessThanOrEqual(80);

    // Save gates on a complete valid form: with a valid name + threshold (default
    // 10000) + email, it enables; clearing the email disables it again.
    await name.fill('CI alert probe');
    await email.fill('alerts@example.com');
    await email.blur();
    await expect(save, 'a complete valid alert form enables save').toBeEnabled({ timeout: 4000 });
    await email.fill('');
    await email.blur();
    await expect(save, 'clearing a required field disables save (canSaveAlert)').toBeDisabled({ timeout: 4000 });
  });
});
