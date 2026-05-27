/**
 * Stripe wrapper. Live mode only in production. Connect Express onboarding + Stripe Link
 * PaymentIntents + Billing meter reports.
 *
 * IMPORTANT: every PaymentIntent uses `automatic_payment_methods: { enabled: true,
 * allow_redirects: 'never' }` per ADR-0004 (Stripe Link exclusively, no Element).
 */

import Stripe from 'stripe';
import type { Env } from '../env.js';
import { AppError, ErrorCode } from '../types.js';

export function makeStripe(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    // Use the Stripe SDK's pinned default API version. Override only when an
    // explicit dashboard version is in play; otherwise the SDK type drives this.
    httpClient: Stripe.createFetchHttpClient(),
  });
}

/** Create Connect Express account onboarding link for a tenant. */
export async function createConnectOnboardingLink(
  env: Env,
  args: { tenantId: string; accountId?: string; returnUrl: string; refreshUrl: string },
): Promise<{ accountId: string; url: string }> {
  const stripe = makeStripe(env);
  let accountId = args.accountId;
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { tenantId: args.tenantId },
    });
    accountId = account.id;
  }
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    return_url: args.returnUrl,
    refresh_url: args.refreshUrl,
  });
  return { accountId, url: link.url };
}

/** Marketplace booking — split with platform take rate (12% default, 8% promo). */
export async function createBookingPaymentIntent(
  env: Env,
  args: {
    tenantId: string;
    bookingId: string;
    amountCents: number;
    currency: string;
    connectedAccountId: string;
    takeRateBps: number;
    customerId?: string;
    isLiveMode: boolean;
  },
): Promise<Stripe.PaymentIntent> {
  const stripe = makeStripe(env);
  const applicationFeeCents = args.isLiveMode
    ? Math.round((args.amountCents * args.takeRateBps) / 10_000)
    : 0;
  return stripe.paymentIntents.create({
    amount: args.amountCents,
    currency: args.currency.toLowerCase(),
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    application_fee_amount: applicationFeeCents,
    on_behalf_of: args.connectedAccountId,
    transfer_data: { destination: args.connectedAccountId },
    customer: args.customerId,
    metadata: {
      tenantId: args.tenantId,
      bookingId: args.bookingId,
      takeRateBps: String(args.takeRateBps),
      rail: 'marketplace',
    },
  });
}

/** Direct tenant payment — 1.5% platform fee. */
export async function createDirectPaymentIntent(
  env: Env,
  args: {
    tenantId: string;
    invoiceId: string;
    amountCents: number;
    currency: string;
    connectedAccountId: string;
    isLiveMode: boolean;
  },
): Promise<Stripe.PaymentIntent> {
  const stripe = makeStripe(env);
  const bps = parseInt(env.DIRECT_TAKE_RATE_BPS, 10);
  const applicationFeeCents = args.isLiveMode
    ? Math.round((args.amountCents * bps) / 10_000)
    : 0;
  return stripe.paymentIntents.create({
    amount: args.amountCents,
    currency: args.currency.toLowerCase(),
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    application_fee_amount: applicationFeeCents,
    on_behalf_of: args.connectedAccountId,
    transfer_data: { destination: args.connectedAccountId },
    metadata: {
      tenantId: args.tenantId,
      invoiceId: args.invoiceId,
      takeRateBps: String(bps),
      rail: 'direct',
    },
  });
}

/** Report a metered usage event (Stripe Billing meters). */
export async function reportMeterEvent(
  env: Env,
  args: {
    eventName: string;
    stripeCustomerId: string;
    value: number;
    identifier: string;
    timestamp: number;
  },
): Promise<void> {
  const stripe = makeStripe(env);
  await stripe.billing.meterEvents.create({
    event_name: args.eventName,
    payload: {
      stripe_customer_id: args.stripeCustomerId,
      value: String(args.value),
    },
    identifier: args.identifier,
    timestamp: args.timestamp,
  });
}

/** Verify webhook signature. Throws AppError on invalid. */
export async function constructWebhookEvent(
  env: Env,
  rawBody: string,
  signature: string,
): Promise<Stripe.Event> {
  const stripe = makeStripe(env);
  try {
    return await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    throw new AppError(
      ErrorCode.WEBHOOK_SIGNATURE_INVALID,
      err instanceof Error ? err.message : 'invalid signature',
    );
  }
}

/** Decide take-rate basis points for a tenant — 8% promo for first 30 days, 12% after. */
export function computeTakeRateBps(env: Env, tenantCreatedAtMs: number): number {
  const promoDays = parseInt(env.PROMO_DAYS, 10);
  const ageDays = (Date.now() - tenantCreatedAtMs) / 86_400_000;
  return ageDays < promoDays
    ? parseInt(env.PROMO_TAKE_RATE_BPS, 10)
    : parseInt(env.PLATFORM_TAKE_RATE_BPS, 10);
}
