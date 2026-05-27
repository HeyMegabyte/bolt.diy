/**
 * upgrade-downgrade.spec.ts — TDD RED phase
 *
 * Upgrade dialog opens, prorated preview shown, Stripe Link iframe mounts,
 * success path completes.
 */

import { test, expect } from '../_fixtures/auth.js';

test.describe('plan upgrade / downgrade', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.route('**/api/billing/subscription**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          plan: 'starter',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      });
    });

    await authedPage.route('**/api/billing/upgrade-preview**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          prorationAmount: 2500, // $25.00 in cents
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          newPlan: 'pro',
        }),
      });
    });

    await authedPage.route('**/api/billing/upgrade**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          clientSecret: 'pi_test_upgrade_secret_mock',
          subscriptionId: 'sub_test_001',
        }),
      });
    });

    await authedPage.goto('/');
    const billingLink = authedPage
      .getByRole('link', { name: /billing|subscription|plan/i })
      .or(authedPage.getByTestId('nav-billing'));
    await billingLink.click();
    await expect(authedPage).toHaveURL(/\/(billing|plan|subscription)/);
  });

  test('upgrade dialog opens with plan options', async ({ authedPage }) => {
    const upgradeBtn = authedPage
      .getByRole('button', { name: /upgrade|change plan/i })
      .or(authedPage.getByTestId('billing-upgrade-btn'));
    await expect(upgradeBtn).toBeVisible({ timeout: 8_000 });
    await upgradeBtn.click();

    const dialog = authedPage
      .getByRole('dialog')
      .or(authedPage.getByTestId('upgrade-dialog'));
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // At least one plan option must be visible
    await expect(
      dialog.getByRole('radio').or(dialog.getByTestId(/plan-option-/)),
    ).not.toHaveCount(0);
  });

  test('selecting a higher plan shows prorated preview', async ({ authedPage }) => {
    const upgradeBtn = authedPage
      .getByRole('button', { name: /upgrade|change plan/i })
      .or(authedPage.getByTestId('billing-upgrade-btn'));
    await upgradeBtn.click();

    const dialog = authedPage.getByRole('dialog').or(authedPage.getByTestId('upgrade-dialog'));
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Select the Pro plan
    const proPlan = dialog
      .getByRole('radio', { name: /pro/i })
      .or(dialog.getByTestId('plan-option-pro'));
    await expect(proPlan).toBeVisible();
    await proPlan.click();

    // Prorated amount should display
    const prorationDisplay = dialog
      .getByTestId('proration-amount')
      .or(dialog.getByText(/\$25|\$0\.25|proration|pro-rate/i));
    await expect(prorationDisplay).toBeVisible({ timeout: 5_000 });
  });

  test('Stripe Link iframe mounts on payment step', async ({ authedPage }) => {
    const upgradeBtn = authedPage
      .getByRole('button', { name: /upgrade|change plan/i })
      .or(authedPage.getByTestId('billing-upgrade-btn'));
    await upgradeBtn.click();

    const dialog = authedPage.getByRole('dialog').or(authedPage.getByTestId('upgrade-dialog'));
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const proPlan = dialog.getByRole('radio', { name: /pro/i }).or(dialog.getByTestId('plan-option-pro'));
    await proPlan.click();

    const continueBtn = dialog
      .getByRole('button', { name: /continue|confirm|pay now/i })
      .or(dialog.getByTestId('upgrade-confirm-btn'));
    await continueBtn.click();

    // Stripe Link / payment iframe must mount exactly once
    await expect(
      authedPage.locator('iframe[src*="stripe"], iframe[name*="stripe"]'),
    ).toHaveCount(1, { timeout: 10_000 });
  });

  test('success path completes and subscription updates', async ({ authedPage }) => {
    // Mock Stripe confirmation returning success
    await authedPage.route('**/api/billing/confirm-upgrade**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ plan: 'pro', status: 'active' }),
      });
    });

    // Simulate the success callback URL
    await authedPage.goto('/dashboard/billing?upgrade=success&plan=pro');

    await expect(
      authedPage.getByRole('status').or(authedPage.getByTestId('toast-success')),
    ).toBeVisible({ timeout: 8_000 });

    // Plan label should update
    await expect(
      authedPage.getByText(/pro plan|upgraded to pro/i).or(authedPage.getByTestId('current-plan-label')),
    ).toBeVisible({ timeout: 5_000 });
  });
});
