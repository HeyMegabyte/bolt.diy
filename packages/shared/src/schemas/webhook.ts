/**
 * Webhook schemas (generic framework)
 */
import { z } from 'zod';
import { uuidSchema, timestampsSchema } from './base.js';
import { WEBHOOK_PROVIDERS } from '../constants/index.js';

// ============================================================================
// WEBHOOK EVENT
// ============================================================================

export const webhookProviderSchema = z.enum([
  WEBHOOK_PROVIDERS.STRIPE,
  WEBHOOK_PROVIDERS.CHATWOOT,
  WEBHOOK_PROVIDERS.DUB,
  WEBHOOK_PROVIDERS.NOVU,
  WEBHOOK_PROVIDERS.LAGO,
]);

export const webhookEventSchema = z.object({
  id: uuidSchema,
  provider: webhookProviderSchema,
  event_id: z.string().max(255),
  event_type: z.string().max(100),
  payload_r2_path: z.string().nullable().optional(),
  payload_size_bytes: z.number().int().nonnegative().nullable().optional(),
  processed_at: z.string().datetime().nullable().optional(),
  processing_error: z.string().nullable().optional(),
  idempotency_key: z.string().max(255),
  request_id: z.string().max(100).nullable().optional(),
  ip_address: z.string().nullable().optional(),
  ...timestampsSchema.shape,
});

// ============================================================================
// STRIPE WEBHOOK PAYLOADS
// ============================================================================

export const stripeCheckoutSessionCompletedSchema = z.object({
  id: z.string(),
  object: z.literal('checkout.session'),
  customer: z.string(),
  subscription: z.string().nullable().optional(),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  status: z.enum(['complete', 'expired', 'open']),
  mode: z.enum(['payment', 'setup', 'subscription']),
  amount_total: z.number().int().nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  customer_email: z.string().email().nullable().optional(),
  metadata: z.record(z.string()).nullable().optional(),
});

export const stripeSubscriptionSchema = z.object({
  id: z.string(),
  object: z.literal('subscription'),
  customer: z.string(),
  status: z.enum([
    'active',
    'past_due',
    'canceled',
    'unpaid',
    'trialing',
    'paused',
    'incomplete',
    'incomplete_expired',
  ]),
  current_period_start: z.number(),
  current_period_end: z.number(),
  cancel_at_period_end: z.boolean(),
  canceled_at: z.number().nullable().optional(),
  ended_at: z.number().nullable().optional(),
  trial_start: z.number().nullable().optional(),
  trial_end: z.number().nullable().optional(),
  items: z.object({
    data: z.array(
      z.object({
        id: z.string(),
        price: z.object({
          id: z.string(),
          unit_amount: z.number().nullable().optional(),
          currency: z.string(),
        }),
      })
    ),
  }),
  metadata: z.record(z.string()).nullable().optional(),
});

export const stripeInvoiceSchema = z.object({
  id: z.string(),
  object: z.literal('invoice'),
  customer: z.string(),
  subscription: z.string().nullable().optional(),
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']),
  amount_due: z.number().int(),
  amount_paid: z.number().int(),
  currency: z.string().length(3),
  due_date: z.number().nullable().optional(),
  paid_at: z.number().nullable().optional(),
  hosted_invoice_url: z.string().url().nullable().optional(),
  invoice_pdf: z.string().url().nullable().optional(),
});

export const stripeEventSchema = z.object({
  id: z.string(),
  object: z.literal('event'),
  type: z.string(),
  created: z.number(),
  livemode: z.boolean(),
  data: z.object({
    object: z.record(z.unknown()),
  }),
});

// ============================================================================
// SALE WEBHOOK (outbound callback)
// ============================================================================

export const saleWebhookPayloadSchema = z.object({
  site_id: uuidSchema,
  org_id: uuidSchema,
  stripe_customer_id: z.string(),
  stripe_subscription_id: z.string(),
  plan: z.string(),
  amount_cents: z.number().int(),
  currency: z.string().length(3),
  timestamp: z.string().datetime(),
  request_id: z.string(),
  trace_id: z.string(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type WebhookProvider = z.infer<typeof webhookProviderSchema>;
export type WebhookEvent = z.infer<typeof webhookEventSchema>;
export type StripeCheckoutSessionCompleted = z.infer<
  typeof stripeCheckoutSessionCompletedSchema
>;
export type StripeSubscription = z.infer<typeof stripeSubscriptionSchema>;
export type StripeInvoice = z.infer<typeof stripeInvoiceSchema>;
export type StripeEvent = z.infer<typeof stripeEventSchema>;
export type SaleWebhookPayload = z.infer<typeof saleWebhookPayloadSchema>;
