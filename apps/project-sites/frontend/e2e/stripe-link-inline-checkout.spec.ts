/**
 * Stripe Link inline 1-click checkout — Playwright E2E.
 *
 * Drives `<app-inline-checkout>` mounted at `/checkout` under the
 * `brian@megabyte.space` stub. Verifies the Worker `POST /api/billing/payment-intent`
 * round-trip, the Express Checkout Element host + Payment Element host mount,
 * and that no console errors / CSP violations fire during the flow.
 *
 * Stripe.js is stubbed at the network layer — we block the real
 * `js.stripe.com/v3/` script so the test runs offline and deterministically.
 * The component still receives a fully-formed `client_secret` from the
 * mocked Worker response, and the loading/error/ready signals are still
 * exercised end-to-end.
 */
import { test, expect, STUB_USER } from './fixtures';

const STRIPE_JS = /js\.stripe\.com\/v3/;

test.describe('Stripe Link inline 1-click checkout', () => {
  test.beforeEach(async ({ authedPage }) => {
    // Block real Stripe.js so the test is fully hermetic. The component's
    // loadStripe() promise resolves null, mountExpressCheckout returns null,
    // and the loading signal flips to error — that path is what we assert.
    await authedPage.route(STRIPE_JS, (route) => route.abort());
  });

  test('mounts inline checkout under brian@megabyte.space stub', async ({ authedPage }) => {
    await authedPage.goto('/');
    await authedPage.waitForLoadState('domcontentloaded');

    // Verify stub user is signed in before navigating to checkout.
    const user = await authedPage.evaluate(() => localStorage.getItem('ps_user'));
    expect(user).toContain(STUB_USER.email);

    await authedPage.goto('/checkout?amount=2500&desc=Test+credit+pack');
    await expect(authedPage.getByTestId('checkout-heading')).toBeVisible();
    await expect(authedPage.getByTestId('inline-checkout')).toBeVisible();
  });

  test('calls POST /api/billing/payment-intent with the right body', async ({ authedPage }) => {
    const piRequest = authedPage.waitForRequest(
      (req) => req.url().includes('/api/billing/payment-intent') && req.method() === 'POST',
    );
    await authedPage.goto('/checkout?amount=2500&desc=Test');
    const req = await piRequest;
    const body = req.postDataJSON() as Record<string, unknown>;
    expect(body['amount_cents']).toBe(2500);
    expect(body['description']).toBe('Test');
    expect(body['save_for_future_use']).toBe(true);
  });

  test('renders amount as $25 from amount=2500 cents', async ({ authedPage }) => {
    await authedPage.goto('/checkout?amount=2500');
    const amount = authedPage.locator('.inline-checkout__amount');
    await expect(amount).toBeVisible();
    await expect(amount).toContainText('$25');
  });

  test('renders amount as $19.99 from amount=1999 cents', async ({ authedPage }) => {
    await authedPage.goto('/checkout?amount=1999');
    await expect(authedPage.locator('.inline-checkout__amount')).toContainText('$19.99');
  });

  test('defaults to $25 when no amount param', async ({ authedPage }) => {
    await authedPage.goto('/checkout');
    await expect(authedPage.locator('.inline-checkout__amount')).toContainText('$25');
  });

  test('shows error state when Stripe.js is unreachable', async ({ authedPage }) => {
    await authedPage.goto('/checkout?amount=2500');
    // Stripe.js is blocked, so loadStripe resolves null and mounts fail.
    // The component should surface an error state and a retry button.
    await expect(authedPage.getByTestId('inline-checkout-error')).toBeVisible({ timeout: 8000 });
    await expect(authedPage.locator('.inline-checkout__retry')).toBeVisible();
  });

  test('Express Checkout + Payment Element hosts exist in the DOM', async ({ authedPage }) => {
    await authedPage.goto('/checkout?amount=2500');
    await expect(authedPage.getByTestId('inline-checkout-express')).toBeAttached();
    await expect(authedPage.getByTestId('inline-checkout-payment')).toBeAttached();
  });

  test('no console errors during checkout mount (Stripe block expected)', async ({
    authedPage,
  }) => {
    const errors: string[] = [];
    authedPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        const txt = msg.text();
        // The Stripe.js network block is the only allowed error (it's the
        // test's deliberate hermetic stub, not a real failure).
        if (!/stripe|Failed to load resource/i.test(txt)) {
          errors.push(txt);
        }
      }
    });
    await authedPage.goto('/checkout?amount=2500');
    await authedPage.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });

  test('emits succeeded → success screen with paymentIntentId', async ({ authedPage }) => {
    // ?test_hook=1 attaches window.__psCheckoutSuccess so we can simulate
    // the Stripe SDK firing onConfirm without a real card.
    await authedPage.goto('/checkout?amount=2500&test_hook=1');
    await expect(authedPage.getByTestId('inline-checkout')).toBeVisible();
    await authedPage.evaluate(() => {
      const fn = (window as unknown as Record<string, (id: string) => void>)['__psCheckoutSuccess'];
      if (typeof fn === 'function') fn('pi_mock_test_123');
    });
    await expect(authedPage.getByTestId('checkout-success')).toBeVisible();
    await expect(authedPage.getByTestId('checkout-success')).toContainText('pi_mock_test_123');
  });
});
