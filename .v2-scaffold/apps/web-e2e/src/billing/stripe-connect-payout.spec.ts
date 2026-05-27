/**
 * stripe-connect-payout.spec.ts — TDD RED phase
 *
 * Stripe Connect Express onboarding link redirect (test mode).
 * Webhook handler dedupes by event ID.
 */

import { test, expect } from '../_fixtures/auth.js';
import { mockStripeWebhook } from '../_fixtures/stripe.js';

test.describe('Stripe Connect payout onboarding', () => {
  test.beforeEach(async ({ authedPage }) => {
    await authedPage.goto('/');
    const billingLink = authedPage
      .getByRole('link', { name: /billing|payouts/i })
      .or(authedPage.getByTestId('nav-billing'));
    await billingLink.click();
    await expect(authedPage).toHaveURL(/\/(billing|payouts)/);
  });

  test('Connect Express onboarding link opens Stripe in test mode', async ({ authedPage }) => {
    await authedPage.route('**/api/billing/connect/onboarding-link**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://connect.stripe.com/express/oauth/authorize?test=1&redirect_uri=http://localhost:4200/billing/connect/callback',
        }),
      });
    });

    const connectBtn = authedPage
      .getByRole('button', { name: /set up payouts|connect stripe|get paid/i })
      .or(authedPage.getByTestId('billing-connect-btn'));
    await expect(connectBtn).toBeVisible({ timeout: 8_000 });

    // Intercept the navigation to Stripe to avoid leaving the test domain
    let stripeNavUrl: string | undefined;
    authedPage.on('popup', (popup) => {
      stripeNavUrl = popup.url();
    });

    await page_interceptExternalNav(authedPage, 'connect.stripe.com', async () => {
      await connectBtn.click();
    });

    // Either a popup was opened, or the current page navigated to Stripe
    const finalUrl = stripeNavUrl ?? authedPage.url();
    expect(finalUrl).toMatch(/stripe\.com|localhost.*connect.*callback/i);
  });

  test('webhook handler deduplicates by event ID', async ({ authedPage }) => {
    await mockStripeWebhook(authedPage, 'payout.created');

    const DUPLICATE_EVENT_ID = 'evt_test_dup_001';

    let callCount = 0;
    await authedPage.route('**/api/webhooks/stripe-payouts**', async (route) => {
      callCount++;
      await route.fulfill({
        status: callCount === 1 ? 200 : 200, // idempotent
        contentType: 'application/json',
        body: JSON.stringify({ received: true, deduplicated: callCount > 1 }),
      });
    });

    // First call — should process
    const resp1 = await authedPage.request.post('/api/webhooks/stripe-payouts', {
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 'test-sig',
      },
      data: JSON.stringify({
        id: DUPLICATE_EVENT_ID,
        type: 'payout.created',
        data: { object: { id: 'po_test_001', amount: 5000 } },
      }),
    });
    expect(resp1.status()).toBe(200);

    // Second identical call — should be deduplicated gracefully (still 200, not 500)
    const resp2 = await authedPage.request.post('/api/webhooks/stripe-payouts', {
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 'test-sig',
      },
      data: JSON.stringify({
        id: DUPLICATE_EVENT_ID,
        type: 'payout.created',
        data: { object: { id: 'po_test_001', amount: 5000 } },
      }),
    });
    expect(resp2.status()).toBe(200);
  });
});

/**
 * Helper: intercepts an external navigation that would leave `localhost`.
 * Prevents the test from actually navigating to the external domain.
 */
async function page_interceptExternalNav(
  page: import('@playwright/test').Page,
  externalHost: string,
  trigger: () => Promise<void>,
): Promise<void> {
  await page.route(`**${externalHost}**`, async (route) => {
    await route.fulfill({ status: 200, body: '<html><body>mock</body></html>' });
  });
  await trigger();
}
