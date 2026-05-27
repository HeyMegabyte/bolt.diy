/**
 * Stripe Connect Express helpers for tenant runtime.
 *
 * @remarks
 *  Tenant runtime creates PaymentIntents on behalf of the connected account
 *  using the `Stripe-Account` header. Per BILLING.md the platform takes a
 *  1.5% application fee on every PaymentIntent. Webhook signatures are
 *  verified inside `routes/stripe-webhook.ts` with `Stripe.webhooks.constructEventAsync`
 *  using the Workers-compatible async crypto path.
 *
 * @example
 *   const pi = await createConnectedPaymentIntent(stripe, {
 *     amountCents: 5000, currency: 'usd', connectedAccountId, feeBps: 150,
 *   });
 */
import Stripe from 'stripe';

export interface CreateIntentArgs {
  amountCents: number;
  currency: string;
  connectedAccountId: string;
  feeBps: number;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

export function makeStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    apiVersion: '2025-09-30.acacia' as Stripe.LatestApiVersion,
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
  });
}

export function computeApplicationFee(amountCents: number, feeBps: number): number {
  // basis points: 150 = 1.5%
  return Math.floor((amountCents * feeBps) / 10_000);
}

export async function createConnectedPaymentIntent(
  stripe: Stripe,
  args: CreateIntentArgs,
): Promise<Stripe.PaymentIntent> {
  const application_fee_amount = computeApplicationFee(args.amountCents, args.feeBps);
  return stripe.paymentIntents.create(
    {
      amount: args.amountCents,
      currency: args.currency,
      application_fee_amount,
      automatic_payment_methods: { enabled: true },
      receipt_email: args.customerEmail,
      metadata: { ...(args.metadata ?? {}), platform: 'projectsites.dev' },
    },
    { stripeAccount: args.connectedAccountId, idempotencyKey: args.metadata?.['idempotency_key'] },
  );
}

export async function verifyWebhookSignature(
  stripe: Stripe,
  payload: string,
  header: string,
  secret: string,
): Promise<Stripe.Event> {
  return stripe.webhooks.constructEventAsync(payload, header, secret, 300, Stripe.createSubtleCryptoProvider());
}
