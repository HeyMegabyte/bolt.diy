/**
 * Playwright spec for `/dashboard/billing`.
 *
 * @remarks
 * Real-user flows only — start at `/`, navigate via clicks/keyboard.
 * Per `[[e2e-tdd-organization]]`: hermetic, parallel-safe, deterministic.
 *
 * Coverage:
 *  - Page renders core sections (plan card, usage meter, invoices grid).
 *  - Upgrade dialog opens and Stripe Embedded Checkout mount node appears
 *    AFTER continue (we never assert iframe internals — Stripe's job).
 *  - Live usage WS frame updates the meter.
 *  - Customer Portal button calls API and opens a new window.
 *  - Connect onboarding button navigates to `/dashboard/billing/connect`.
 *  - Refund dialog opens and submits.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

async function gotoBilling(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: /billing/i }).click();
  await expect(page.getByTestId('billing-page')).toBeVisible();
}

test.describe('Billing page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/billing/subscription', (route: Route) =>
      route.fulfill({
        json: {
          plan_tier: 'starter',
          sites_max: 5,
          domains_max: 5,
          ai_credits_remaining: 1000,
          seats_max: 3,
          features: {},
          renews_at: '2026-06-26T00:00:00.000Z',
          cancel_at: null,
        },
      }),
    );
    await page.route('**/api/billing/invoices', (route: Route) =>
      route.fulfill({ json: { invoices: [] } }),
    );
    await page.route('**/api/billing/receipts', (route: Route) =>
      route.fulfill({ json: { receipts: [] } }),
    );
    await page.route('**/api/billing/payment-methods', (route: Route) =>
      route.fulfill({ json: { methods: [] } }),
    );
  });

  test('renders plan card and usage meter', async ({ page }) => {
    await gotoBilling(page);
    await expect(page.getByTestId('plan-card')).toBeVisible();
    await expect(page.getByTestId('usage-meter')).toBeVisible();
    await expect(page.getByTestId('invoices-grid')).toBeVisible();
  });

  test('upgrade dialog opens via UI and mounts Stripe Embedded Checkout', async ({
    page,
  }) => {
    await page.route('**/api/billing/checkout', (route: Route) =>
      route.fulfill({
        json: {
          client_secret: 'cs_test_abc123',
          session_id: 'cs_sess_1',
        },
      }),
    );
    await gotoBilling(page);
    await page.getByTestId('upgrade-btn').click();
    await expect(page.getByTestId('upgrade-dialog')).toBeVisible();
    await page.getByTestId('upgrade-continue').click();
    await expect(page.getByTestId('stripe-embedded-checkout')).toBeVisible();
    await expect(page.getByTestId('stripe-embedded-checkout')).toHaveAttribute(
      'data-client-secret',
      'cs_test_abc123',
    );
  });

  test('customer portal button opens new window', async ({ page, context }) => {
    await page.route('**/api/billing/portal', (route: Route) =>
      route.fulfill({ json: { portal_url: 'https://billing.stripe.com/p_test' } }),
    );
    await gotoBilling(page);
    const popupPromise = context.waitForEvent('page');
    await page.getByTestId('portal-btn').click();
    const popup = await popupPromise;
    expect(popup.url()).toContain('billing.stripe.com');
  });

  test('refund dialog submits and clears form', async ({ page }) => {
    await page.route('**/api/billing/refunds', (route: Route) =>
      route.fulfill({
        json: { id: 'rf_1', status: 'pending_review' },
      }),
    );
    await gotoBilling(page);
    await page.getByTestId('refund-btn').click();
    await expect(page.getByTestId('refund-form')).toBeVisible();
    await page.getByTestId('refund-charge-id').fill('ch_test_123');
    await page.getByTestId('refund-submit').click();
    await expect(page.getByRole('status')).toContainText('Request submitted');
  });

  test('connect onboarding redirects via window.location', async ({ page }) => {
    await page.route(
      '**/api/billing/connect/onboarding-link',
      (route: Route) =>
        route.fulfill({
          json: {
            onboarding_url: 'https://connect.stripe.com/setup/e/acct_test',
            expires_at: '2026-05-27T00:00:00.000Z',
          },
        }),
    );
    await gotoBilling(page);
    await page.getByTestId('connect-onboarding-btn').click();
    await expect(page).toHaveURL(/\/dashboard\/billing\/connect/);
    const navigationPromise = page.waitForURL(/connect\.stripe\.com/);
    await page.getByTestId('start-connect-btn').click();
    await navigationPromise;
  });

  test('live usage WebSocket frame updates the meter', async ({ page }) => {
    await page.addInitScript(() => {
      class MockSocket extends EventTarget {
        readyState = 0;
        constructor(public readonly url: string) {
          super();
          setTimeout(() => {
            this.readyState = 1;
            this.dispatchEvent(new Event('open'));
            this.dispatchEvent(
              new MessageEvent('message', {
                data: JSON.stringify({
                  type: 'usage',
                  period_requests: 87_500,
                  included: 100_000,
                  overage_cents: 0,
                  pct_of_quota: 87.5,
                  projected_period_overage_cents: 0,
                  ts: new Date().toISOString(),
                }),
              }),
            );
          }, 10);
        }
        send() {}
        close() {
          this.readyState = 3;
        }
      }
      (window as unknown as { WebSocket: typeof MockSocket }).WebSocket =
        MockSocket;
    });
    await gotoBilling(page);
    await expect(page.getByTestId('usage-current')).toContainText('87,500');
  });
});
