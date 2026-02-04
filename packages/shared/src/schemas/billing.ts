/**
 * Billing and subscription schemas
 */
import { z } from 'zod';
import {
  uuidSchema,
  centsSchema,
  timestampsSchema,
  emailSchema,
} from './base.js';
import { SUBSCRIPTION_STATES, PRICING } from '../constants/index.js';

// ============================================================================
// SUBSCRIPTION
// ============================================================================

export const subscriptionStateSchema = z.enum([
  SUBSCRIPTION_STATES.ACTIVE,
  SUBSCRIPTION_STATES.PAST_DUE,
  SUBSCRIPTION_STATES.CANCELED,
  SUBSCRIPTION_STATES.UNPAID,
  SUBSCRIPTION_STATES.TRIALING,
  SUBSCRIPTION_STATES.PAUSED,
]);

export const subscriptionSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  stripe_subscription_id: z.string(),
  stripe_customer_id: z.string(),
  stripe_price_id: z.string(),
  state: subscriptionStateSchema,
  current_period_start: z.string().datetime(),
  current_period_end: z.string().datetime(),
  cancel_at_period_end: z.boolean().default(false),
  canceled_at: z.string().datetime().nullable().optional(),
  ended_at: z.string().datetime().nullable().optional(),
  trial_start: z.string().datetime().nullable().optional(),
  trial_end: z.string().datetime().nullable().optional(),
  monthly_amount_cents: centsSchema,
  currency: z.string().length(3).default('usd'),
  ...timestampsSchema.shape,
});

export const createSubscriptionInputSchema = z.object({
  stripe_subscription_id: z.string(),
  stripe_customer_id: z.string(),
  stripe_price_id: z.string(),
  state: subscriptionStateSchema,
  current_period_start: z.string().datetime(),
  current_period_end: z.string().datetime(),
  monthly_amount_cents: centsSchema.default(PRICING.MONTHLY_CENTS),
});

// ============================================================================
// ENTITLEMENTS
// ============================================================================

export const entitlementsSchema = z.object({
  topBarHidden: z.boolean(),
  maxCustomDomains: z.number().int().nonnegative(),
  analyticsAccess: z.enum(['none', 'basic', 'full']),
  supportPriority: z.enum(['community', 'standard', 'priority']),
});

// ============================================================================
// CHECKOUT SESSION
// ============================================================================

export const checkoutSessionInputSchema = z.object({
  site_id: uuidSchema,
  success_url: z.string().url(),
  cancel_url: z.string().url(),
  customer_email: emailSchema.optional(),
});

export const checkoutSessionOutputSchema = z.object({
  checkout_url: z.string().url(),
  session_id: z.string(),
});

// ============================================================================
// BILLING PORTAL
// ============================================================================

export const billingPortalInputSchema = z.object({
  return_url: z.string().url(),
});

export const billingPortalOutputSchema = z.object({
  portal_url: z.string().url(),
});

// ============================================================================
// INVOICE
// ============================================================================

export const invoiceSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  stripe_invoice_id: z.string(),
  stripe_subscription_id: z.string().nullable().optional(),
  amount_due: centsSchema,
  amount_paid: centsSchema,
  currency: z.string().length(3),
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']),
  due_date: z.string().datetime().nullable().optional(),
  paid_at: z.string().datetime().nullable().optional(),
  hosted_invoice_url: z.string().url().nullable().optional(),
  invoice_pdf: z.string().url().nullable().optional(),
  ...timestampsSchema.shape,
});

// ============================================================================
// USAGE EVENT (for internal metering when Lago is off)
// ============================================================================

export const usageEventSchema = z.object({
  id: uuidSchema,
  org_id: uuidSchema,
  event_type: z.string().min(1).max(100),
  quantity: z.number().positive(),
  properties: z.record(z.unknown()).nullable().optional(),
  idempotency_key: z.string().max(255).nullable().optional(),
  ...timestampsSchema.shape,
});

export const createUsageEventInputSchema = z.object({
  event_type: z.string().min(1).max(100),
  quantity: z.number().positive().default(1),
  properties: z.record(z.unknown()).optional(),
  idempotency_key: z.string().max(255).optional(),
});

// ============================================================================
// DUNNING STATE
// ============================================================================

export const dunningStateSchema = z.object({
  org_id: uuidSchema,
  days_overdue: z.number().int().nonnegative(),
  last_reminder_sent_at: z.string().datetime().nullable().optional(),
  reminder_count: z.number().int().nonnegative(),
  downgraded_at: z.string().datetime().nullable().optional(),
  suspended_at: z.string().datetime().nullable().optional(),
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type SubscriptionState = z.infer<typeof subscriptionStateSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
export type CreateSubscriptionInput = z.infer<
  typeof createSubscriptionInputSchema
>;
export type Entitlements = z.infer<typeof entitlementsSchema>;
export type CheckoutSessionInput = z.infer<typeof checkoutSessionInputSchema>;
export type CheckoutSessionOutput = z.infer<typeof checkoutSessionOutputSchema>;
export type BillingPortalInput = z.infer<typeof billingPortalInputSchema>;
export type BillingPortalOutput = z.infer<typeof billingPortalOutputSchema>;
export type Invoice = z.infer<typeof invoiceSchema>;
export type UsageEvent = z.infer<typeof usageEventSchema>;
export type CreateUsageEventInput = z.infer<typeof createUsageEventInputSchema>;
export type DunningState = z.infer<typeof dunningStateSchema>;
