/**
 * quote-to-pay.spec.ts — TDD RED phase
 *
 * Verifies:
 * - /dashboard/quotes/:id loads with prefilled editable fields
 * - Clicking pay ONCE mounts Stripe iframe ONCE
 * - Double-click guard: rapid double-click still mounts exactly ONE iframe
 * - Schedule-bounce guard: editing day-1 start time does not change day-2 fields
 */

import { test, expect } from '../_fixtures/auth.js';
import { mockStripePaymentSuccess } from '../_fixtures/stripe.js';

const TEST_QUOTE_ID = 'quote-test-001';

test.describe('quote-to-pay flow', () => {
  test.beforeEach(async ({ authedPage }) => {
    // Seed route mock so the quote exists without real DB
    await authedPage.route(`**/api/quotes/${TEST_QUOTE_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: TEST_QUOTE_ID,
          status: 'pending',
          totalAmount: 15000,
          days: [
            { day: 1, startTime: '08:00', endTime: '16:00' },
            { day: 2, startTime: '08:00', endTime: '16:00' },
          ],
          clientName: 'Acme Corp',
          clientEmail: 'acme@example.com',
        }),
      });
    });

    await authedPage.goto('/');
    const quotesLink = authedPage
      .getByRole('link', { name: /quotes/i })
      .or(authedPage.getByTestId('nav-quotes'));
    await quotesLink.click();
    await expect(authedPage).toHaveURL(/\/quotes/);
  });

  test('prefilled fields are editable', async ({ authedPage }) => {
    // Navigate to quote detail
    await authedPage.goto(`/dashboard/quotes/${TEST_QUOTE_ID}`);
    await expect(authedPage).toHaveURL(new RegExp(TEST_QUOTE_ID));

    const clientNameField = authedPage
      .getByRole('textbox', { name: /client name/i })
      .or(authedPage.getByTestId('quote-client-name'));
    await expect(clientNameField).toBeVisible({ timeout: 5_000 });
    await expect(clientNameField).toHaveValue(/Acme Corp/);

    // Verify it is editable
    await clientNameField.clear();
    await clientNameField.fill('New Client Name');
    await expect(clientNameField).toHaveValue('New Client Name');
  });

  test('clicking pay ONCE mounts Stripe iframe exactly once', async ({ authedPage }) => {
    await mockStripePaymentSuccess(authedPage);

    await authedPage.route('**/api/quotes/*/payment-intent', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ clientSecret: 'pi_test_mock_secret_mock' }),
      });
    });

    await authedPage.goto(`/dashboard/quotes/${TEST_QUOTE_ID}`);

    const payBtn = authedPage
      .getByRole('button', { name: /pay|checkout/i })
      .or(authedPage.getByTestId('quote-pay-btn'));
    await expect(payBtn).toBeVisible({ timeout: 5_000 });
    await payBtn.click();

    // Exactly 1 Stripe iframe should mount
    const stripeFrameLocator = authedPage.frameLocator('iframe[name*="stripe"], iframe[src*="stripe"]');
    await expect(authedPage.locator('iframe[src*="stripe"], iframe[name*="stripe"]')).toHaveCount(1, {
      timeout: 8_000,
    });
  });

  test('double-click guard — rapid double-click still mounts exactly 1 Stripe iframe', async ({ authedPage }) => {
    await mockStripePaymentSuccess(authedPage);

    await authedPage.route('**/api/quotes/*/payment-intent', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ clientSecret: 'pi_test_mock_secret_mock' }),
      });
    });

    await authedPage.goto(`/dashboard/quotes/${TEST_QUOTE_ID}`);

    const payBtn = authedPage
      .getByRole('button', { name: /pay|checkout/i })
      .or(authedPage.getByTestId('quote-pay-btn'));
    await expect(payBtn).toBeVisible({ timeout: 5_000 });

    // Rapid double-click
    await payBtn.dblclick();

    await expect(authedPage.locator('iframe[src*="stripe"], iframe[name*="stripe"]')).toHaveCount(1, {
      timeout: 8_000,
    });
  });

  test('schedule-bounce guard — editing day-1 start time does not change day-2', async ({ authedPage }) => {
    await authedPage.goto(`/dashboard/quotes/${TEST_QUOTE_ID}`);

    const day1StartInput = authedPage
      .getByTestId('quote-day-1-start-time')
      .or(authedPage.getByLabel(/day 1.*start/i));
    const day2StartInput = authedPage
      .getByTestId('quote-day-2-start-time')
      .or(authedPage.getByLabel(/day 2.*start/i));

    await expect(day2StartInput).toBeVisible({ timeout: 5_000 });
    const originalDay2Value = await day2StartInput.inputValue();

    // Change day-1
    await day1StartInput.fill('10:00');
    await day1StartInput.press('Tab');

    // Day-2 must be unchanged
    await expect(day2StartInput).toHaveValue(originalDay2Value);
  });
});
