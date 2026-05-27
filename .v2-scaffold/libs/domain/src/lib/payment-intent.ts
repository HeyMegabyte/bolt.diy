/**
 * `POST /api/billing/checkout` (Stripe PaymentIntent) request payload.
 * Mirrors `packages/shared/src/schemas/billing.ts` from the worker
 * monorepo; duplicated here so v2 apps don't reach into v1 packages.
 */
import { z } from 'zod';

export const PaymentIntentModeSchema = z.enum([
  'payment',
  'subscription',
  'setup',
] as const);
export type PaymentIntentMode = z.infer<typeof PaymentIntentModeSchema>;

export const CreatePaymentIntentSchema = z
  .object({
    tenant_id: z.string().min(1),
    mode: PaymentIntentModeSchema,
    price_id: z.string().min(1).nullable(),
    amount_cents: z.number().int().positive().nullable(),
    currency: z.string().length(3),
    description: z.string().max(500).nullable(),
    coupon_code: z.string().max(100).nullable(),
    success_url: z.url(),
    cancel_url: z.url(),
    metadata: z.record(z.string(), z.string()).default({}),
  })
  .strict()
  .refine(
    (v) =>
      (v.mode === 'subscription' && v.price_id !== null) ||
      (v.mode === 'payment' && v.amount_cents !== null) ||
      v.mode === 'setup',
    {
      message:
        'subscription requires price_id; payment requires amount_cents',
    }
  );

export type CreatePaymentIntentInput = z.infer<
  typeof CreatePaymentIntentSchema
>;

export const PaymentIntentResponseSchema = z
  .object({
    client_secret: z.string().min(1),
    publishable_key: z.string().min(1),
    payment_intent_id: z.string().min(1),
  })
  .strict();

export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;
