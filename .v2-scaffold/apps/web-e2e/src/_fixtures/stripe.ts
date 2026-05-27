/**
 * Stripe test-mode helpers + virtual WebAuthn authenticator setup.
 *
 * @remarks
 * These helpers operate in Playwright's browser context using:
 *   - `page.route()` to intercept Stripe iframe / API calls in test-mode
 *   - `page.context().addInitScript()` to register a virtual FIDO2 cred
 *   - Cookie helpers for Stripe Link session state
 *
 * NEVER use real card numbers. All values below are Stripe's published
 * test vectors from https://stripe.com/docs/testing
 */

import type { Page, BrowserContext } from '@playwright/test';

/* ------------------------------------------------------------------ */
/* Test card data (Stripe published test vectors)                       */
/* ------------------------------------------------------------------ */
export const STRIPE_TEST_CARDS = {
  visa: { number: '4242424242424242', expiry: '12/26', cvc: '123' },
  mastercard: { number: '5555555555554444', expiry: '12/26', cvc: '123' },
  decline: { number: '4000000000000002', expiry: '12/26', cvc: '123' },
  requiresAction: { number: '4000002500003155', expiry: '12/26', cvc: '123' },
} as const;

/* ------------------------------------------------------------------ */
/* Route intercept helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Intercepts calls to Stripe's payment-intent confirm endpoint and
 * returns a synthetic succeeded response so tests don't hit the network.
 */
export async function mockStripePaymentSuccess(page: Page): Promise<void> {
  await page.route('**/v1/payment_intents/*/confirm', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'pi_test_mock',
        status: 'succeeded',
        client_secret: 'pi_test_mock_secret_mock',
      }),
    });
  });
}

/**
 * Intercepts the Stripe webhook-forwarded event endpoint and returns 200
 * to prevent real webhook delivery during tests.
 */
export async function mockStripeWebhook(
  page: Page,
  eventType: string = 'checkout.session.completed',
): Promise<void> {
  await page.route('**/api/webhooks/stripe**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ received: true, eventType }),
    });
  });
}

/* ------------------------------------------------------------------ */
/* Virtual WebAuthn authenticator                                       */
/* ------------------------------------------------------------------ */

/**
 * Registers a virtual FIDO2 authenticator in the browser context so
 * passkey-based sign-in flows can be exercised in headless tests.
 *
 * @example
 * ```ts
 * const credId = await registerVirtualPasskey(page.context());
 * await page.goto('/');
 * await page.click('[data-testid="auth-passkey-btn"]');
 * // virtual authenticator auto-approves the assertion
 * ```
 */
export async function registerVirtualPasskey(context: BrowserContext): Promise<string> {
  // Inject a virtual credential store before the page loads.
  await context.addInitScript(() => {
    // Stub navigator.credentials.create + get so Angular's passkey service
    // receives a resolved promise instead of opening a platform UI.
    const VIRTUAL_CRED_ID = 'dmlyX3Rlc3RfY3JlZA=='; // b64 "vir_test_cred"

    const originalCreate = navigator.credentials.create.bind(navigator.credentials);
    const originalGet = navigator.credentials.get.bind(navigator.credentials);

    navigator.credentials.create = async (options?: CredentialCreationOptions) => {
      if (options?.publicKey) {
        return {
          id: VIRTUAL_CRED_ID,
          rawId: Uint8Array.from(atob(VIRTUAL_CRED_ID), (c) => c.charCodeAt(0)),
          response: {
            attestationObject: new ArrayBuffer(0),
            clientDataJSON: new TextEncoder().encode(
              JSON.stringify({ type: 'webauthn.create', challenge: 'test' }),
            ),
          },
          type: 'public-key',
          getClientExtensionResults: () => ({}),
          authenticatorAttachment: 'platform' as const,
        } as unknown as Credential;
      }
      return originalCreate(options);
    };

    navigator.credentials.get = async (options?: CredentialRequestOptions) => {
      if (options?.publicKey) {
        return {
          id: VIRTUAL_CRED_ID,
          rawId: Uint8Array.from(atob(VIRTUAL_CRED_ID), (c) => c.charCodeAt(0)),
          response: {
            authenticatorData: new ArrayBuffer(0),
            clientDataJSON: new TextEncoder().encode(
              JSON.stringify({ type: 'webauthn.get', challenge: 'test' }),
            ),
            signature: new ArrayBuffer(0),
            userHandle: null,
          },
          type: 'public-key',
          getClientExtensionResults: () => ({}),
        } as unknown as Credential;
      }
      return originalGet(options);
    };
  });

  return 'dmlyX3Rlc3RfY3JlZA==';
}
