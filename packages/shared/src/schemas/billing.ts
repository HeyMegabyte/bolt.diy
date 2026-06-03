/**
 * @module billing
 * @packageDocumentation
 *
 * Zod schemas for **subscriptions**, **checkout sessions**, **entitlements**,
 * and **sale webhook payloads**.
 *
 * The billing module models the Stripe-backed subscription lifecycle. Each
 * organization has at most one active subscription that determines its plan
 * (`free | paid`) and associated entitlements. The dunning pipeline tracks
 * failed payments up to 60 days before automatic downgrade.
 *
 * | Zod Schema                     | Inferred Type            | Purpose                                           |
 * | ------------------------------ | ------------------------ | ------------------------------------------------- |
 * | `subscriptionSchema`           | `Subscription`           | Full subscription row from the database            |
 * | `createCheckoutSessionSchema`  | `CreateCheckoutSession`  | Payload for initiating a Stripe Checkout session   |
 * | `entitlementsSchema`           | `Entitlements`           | Feature flags and limits derived from the plan     |
 * | `saleWebhookPayloadSchema`     | `SaleWebhookPayload`    | Internal webhook payload emitted after a sale      |
 *
 * The `stripeEventTypes` tuple and `StripeEventType` union enumerate the
 * Stripe webhook event types the system handles.
 *
 * @example
 * ```ts
 * import { createCheckoutSessionSchema, type CreateCheckoutSession } from '@blitz/shared/schemas/billing';
 *
 * const input: CreateCheckoutSession = {
 *   org_id: '550e8400-e29b-41d4-a716-446655440000',
 *   success_url: 'https://bolt.megabyte.space/success',
 *   cancel_url: 'https://bolt.megabyte.space/cancel',
 * };
 * const parsed = createCheckoutSessionSchema.parse(input);
 * ```
 */
import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { SUBSCRIPTION_STATES } from '../constants/index.js';

/**
 * Full subscription record as stored in the `subscriptions` database table.
 *
 * Tracks the Stripe customer and subscription IDs, the current plan
 * (`free | paid`), the subscription status (one of {@link SUBSCRIPTION_STATES}),
 * billing period boundaries, cancellation intent, retention offers, and the
 * dunning stage (0-60 days past due). Payment timestamps record the last
 * successful and last failed charge.
 *
 * Includes all {@link baseFields} (id, org_id, created_at, updated_at, deleted_at).
 */
export const subscriptionSchema = z.object({
  ...baseFields,
  stripe_customer_id: z.string().max(255),
  stripe_subscription_id: z.string().max(255).nullable(),
  plan: z.enum(['free', 'paid']),
  status: z.enum(SUBSCRIPTION_STATES),
  current_period_start: z.string().datetime().nullable(),
  current_period_end: z.string().datetime().nullable(),
  cancel_at_period_end: z.boolean().default(false),
  retention_offer_applied: z.boolean().default(false),
  dunning_stage: z.number().int().min(0).max(60).default(0),
  last_payment_at: z.string().datetime().nullable(),
  last_payment_failed_at: z.string().datetime().nullable(),
});

/**
 * Request payload for creating a new Stripe Checkout session.
 *
 * Requires the `org_id` that will own the resulting subscription, plus
 * `success_url` and `cancel_url` redirect targets (both must be valid URLs,
 * max 2048 chars). An optional `site_id` ties the checkout to a specific site.
 */
export const budgetTierSchema = z.enum(['free', 'standard', 'plus', 'premium', 'patron']);
export type BudgetTier = z.infer<typeof budgetTierSchema>;

export const createCheckoutSessionSchema = z.object({
  org_id: uuidSchema.optional(),
  site_id: uuidSchema.optional(),
  success_url: z.string().url().max(2048),
  cancel_url: z.string().url().max(2048),
  budget_tier: budgetTierSchema.optional(),
});

/**
 * Validation schema for creating an **embedded** Stripe Checkout session.
 *
 * Uses `ui_mode: 'embedded'` so the checkout form renders inline on the page
 * via Stripe.js `initEmbeddedCheckout()`. Requires a `return_url` with a
 * `{CHECKOUT_SESSION_ID}` placeholder that Stripe replaces on completion.
 */
export const createEmbeddedCheckoutSchema = z.object({
  org_id: uuidSchema.optional(),
  site_id: uuidSchema.optional(),
  return_url: z.string().url().max(2048),
  budget_tier: budgetTierSchema.optional(),
});

/**
 * Validation schema for creating a one-shot Stripe **PaymentIntent** that the
 * frontend mounts via Express Checkout Element (Apple Pay / Google Pay / Link
 * 1-click row) or Payment Element (card + Link Authentication form).
 *
 * Used for inline 1-click upgrades, credit-pack top-ups, and any "just charge
 * me" surface where a Checkout-redirect (or even embedded Checkout) would be
 * heavier than warranted. `automatic_payment_methods.enabled = true` lets
 * Stripe surface every PMC method the account has on — Link, Apple Pay,
 * Google Pay, Klarna, Affirm, card — without us hardcoding the list.
 */
export const createPaymentIntentSchema = z.object({
  org_id: uuidSchema.optional(),
  site_id: uuidSchema.optional(),
  amount_cents: z.number().int().positive().max(99_999_999),
  currency: z
    .string()
    .length(3)
    .regex(/^[a-z]{3}$/)
    .default('usd'),
  description: z.string().max(255).optional(),
  /** When true, attach the payment_method to the customer for future Link 1-click. */
  save_for_future_use: z.boolean().default(true),
});
export type CreatePaymentIntent = z.infer<typeof createPaymentIntentSchema>;

/**
 * Tuple of Stripe webhook event types that the system processes.
 *
 * Used to filter incoming Stripe webhooks to only the events the billing
 * pipeline can handle. Any event type not in this list is acknowledged but
 * ignored.
 *
 * Currently handled events:
 * - `checkout.session.completed` -- new subscription created
 * - `invoice.paid` -- successful recurring payment
 * - `invoice.payment_failed` -- triggers dunning flow
 * - `customer.subscription.updated` -- plan or status change
 * - `customer.subscription.deleted` -- cancellation finalized
 */
export const stripeEventTypes = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;
/** Union type of the Stripe webhook event types the system handles. */
export type StripeEventType = (typeof stripeEventTypes)[number];

/**
 * Feature entitlements derived from an organization's current plan.
 *
 * Returned by the entitlements API endpoint to inform the front-end which
 * features are available. Includes boolean flags (`topBarHidden`,
 * `chatEnabled`, `analyticsEnabled`) and numeric limits
 * (`maxCustomDomains` 0-10). The values mirror the static
 * {@link ENTITLEMENTS} constant but are resolved at runtime per-org.
 */
export const entitlementsSchema = z.object({
  org_id: uuidSchema,
  plan: z.enum(['free', 'paid']),
  topBarHidden: z.boolean(),
  maxCustomDomains: z.number().int().min(0).max(10),
  chatEnabled: z.boolean(),
  analyticsEnabled: z.boolean(),
  /** Team seat cap; `-1` means unlimited. */
  maxTeamSeats: z.number().int().min(-1),
});

/**
 * Internal webhook payload emitted when a sale is recorded.
 *
 * Sent to downstream services (e.g. analytics, CRM) after a successful
 * Stripe checkout. Contains the full context needed for attribution:
 * organization, optional site, Stripe IDs, monetary amount in cents with
 * ISO 4217 currency code (3 chars), an ISO 8601 timestamp, and tracing
 * identifiers (`request_id`, `trace_id`) for observability.
 */
export const saleWebhookPayloadSchema = z.object({
  site_id: uuidSchema.nullable(),
  org_id: uuidSchema,
  stripe_customer_id: z.string().max(255),
  stripe_subscription_id: z.string().max(255),
  plan: z.enum(['free', 'paid']),
  amount_cents: z.number().int().min(0),
  currency: z.string().length(3),
  timestamp: z.string().datetime(),
  request_id: z.string().max(255),
  trace_id: z.string().max(255),
});

/** Inferred TypeScript type for a full subscription record. */
export type Subscription = z.infer<typeof subscriptionSchema>;

/** Inferred TypeScript type for the create-checkout-session request payload. */
export type CreateCheckoutSession = z.infer<typeof createCheckoutSessionSchema>;

/** Inferred TypeScript type for the embedded-checkout request payload. */
export type CreateEmbeddedCheckout = z.infer<typeof createEmbeddedCheckoutSchema>;

/** Inferred TypeScript type for the entitlements response object. */
export type Entitlements = z.infer<typeof entitlementsSchema>;

/** Inferred TypeScript type for the internal sale webhook payload. */
export type SaleWebhookPayload = z.infer<typeof saleWebhookPayloadSchema>;

// ─── Spend Alerts ──────────────────────────────────────────────────────────

/**
 * Trigger that fires a spend alert.
 *
 * - `balance_below` — fires when `credits.getBalance(org)` drops under
 *   `threshold_credits`.
 * - `monthly_spend_above` — fires when the current calendar month's
 *   `usage_events` rollup exceeds `threshold_credits`.
 * - `rate_spike` — fires when burn-rate (credits/hour, 24h moving avg)
 *   exceeds `threshold_credits` over a 1h sliding window.
 */
export const spendAlertTriggerSchema = z.enum([
  'balance_below',
  'monthly_spend_above',
  'rate_spike',
]);
/** Inferred type for the spend-alert trigger enum. */
export type SpendAlertTrigger = z.infer<typeof spendAlertTriggerSchema>;

/** Notification channels supported by a spend alert. */
export const spendAlertChannelSchema = z.enum(['email', 'slack', 'discord', 'pagerduty']);
/** Inferred type for a single spend-alert notification channel. */
export type SpendAlertChannel = z.infer<typeof spendAlertChannelSchema>;

/**
 * Request payload for `POST /api/billing/spend-alerts`.
 *
 * One row per named alert per org. The cron-fan-out sweep consults
 * `trigger_type` + `threshold_credits` to decide whether to email/Slack the
 * recipient(s). `site_id` is optional — when set, the alert scopes to a
 * single site's usage; when null, the alert evaluates against the whole org.
 */
export const createSpendAlertSchema = z.object({
  name: z.string().trim().min(1).max(200),
  site_id: uuidSchema.optional(),
  trigger: spendAlertTriggerSchema,
  threshold_credits: z.number().int().min(0),
  email: z.string().email().max(254),
  channels: z.array(spendAlertChannelSchema).min(1).max(4).default(['email']),
});

/** Inferred TypeScript type for the create-spend-alert request payload. */
export type CreateSpendAlert = z.infer<typeof createSpendAlertSchema>;

/**
 * Full spend-alert record as stored in the `spend_alerts` D1 table.
 *
 * Includes runtime accounting fields (`last_fired_at`, `fire_count`) that
 * the cron sweep updates so a single low-balance condition cannot generate
 * 24 emails/day.
 */
export const spendAlertSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  site_id: uuidSchema.nullable(),
  name: z.string().min(1).max(200),
  trigger_type: spendAlertTriggerSchema,
  threshold_credits: z.number().int().min(0),
  email: z.string().email().max(254),
  channels_json: z.string(),
  last_fired_at: z.string().nullable(),
  fire_count: z.number().int().min(0),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

/** Inferred TypeScript type for a full spend-alert record. */
export type SpendAlert = z.infer<typeof spendAlertSchema>;
