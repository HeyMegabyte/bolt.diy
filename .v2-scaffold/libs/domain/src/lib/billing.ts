/**
 * Billing event + entitlement SSOT. Mirrors D1 `billing_events`,
 * `subscriptions`, `wallet_*`, and `coupons`.
 */
import { z } from 'zod';
import { PlanTierSchema } from './tenant.js';

export const BillingEventKindSchema = z.enum([
  'invoice.created',
  'invoice.paid',
  'invoice.failed',
  'subscription.created',
  'subscription.updated',
  'subscription.cancelled',
  'payment_method.attached',
  'payment_method.detached',
  'refund.issued',
  'wallet.topup',
  'wallet.debit',
  'coupon.applied',
] as const);
export type BillingEventKind = z.infer<typeof BillingEventKindSchema>;

export const BillingEventSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    kind: BillingEventKindSchema,
    amount_cents: z.number().int(),
    currency: z.string().length(3),
    stripe_event_id: z.string().min(1).nullable(),
    payload: z.record(z.string(), z.unknown()),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type BillingEvent = z.infer<typeof BillingEventSchema>;

/**
 * Effective entitlements after applying plan + coupons + overrides.
 * Returned by `GET /api/billing/subscription` and cached in
 * AdminStateService.
 */
export const EntitlementsSchema = z
  .object({
    plan_tier: PlanTierSchema,
    sites_max: z.number().int().nonnegative(),
    domains_max: z.number().int().nonnegative(),
    ai_credits_remaining: z.number().int().nonnegative(),
    seats_max: z.number().int().nonnegative(),
    features: z.record(z.string(), z.boolean()),
    renews_at: z.iso.datetime({ offset: true }).nullable(),
    cancel_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export type Entitlements = z.infer<typeof EntitlementsSchema>;
