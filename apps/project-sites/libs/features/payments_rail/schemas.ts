/**
 * @module libs/features/payments_rail/schemas
 * @description Zod schemas for the Payments Rail feature module.
 * All runtime boundaries — API request bodies, responses — are validated here.
 *
 * @remarks
 * Schemas are the single source of truth; types are inferred via z.infer.
 * Consumers import from this file; never duplicate shapes in service or handler files.
 *
 * @see {@link ./service.ts} business logic
 * @see {@link ./handlers.ts} Hono route handlers
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Supported payment providers
// ---------------------------------------------------------------------------

export const PaymentProviderSchema = z.enum(['stripe', 'square']).describe('Payment gateway provider');
export type PaymentProvider = z.infer<typeof PaymentProviderSchema>;

// ---------------------------------------------------------------------------
// Payment method (GET /api/payments/methods)
// ---------------------------------------------------------------------------

export const PaymentMethodSchema = z
  .object({
    id: z.string().min(1),
    provider: PaymentProviderSchema,
    brand: z.string().optional(),
    last4: z.string().length(4).optional(),
    expMonth: z.number().int().min(1).max(12).optional(),
    expYear: z.number().int().min(2020).optional(),
    isDefault: z.boolean(),
  })
  .strict();

export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentMethodsResponseSchema = z
  .object({
    methods: z.array(PaymentMethodSchema),
    count: z.number().int().nonnegative(),
  })
  .strict();

export type PaymentMethodsResponse = z.infer<typeof PaymentMethodsResponseSchema>;

// ---------------------------------------------------------------------------
// Payment intent (POST /api/payments/intent)
// ---------------------------------------------------------------------------

export const CreatePaymentIntentBodySchema = z
  .object({
    amountCents: z.number().int().positive().describe('Amount in cents (USD)'),
    currency: z.string().length(3).default('usd').describe('ISO 4217 currency code'),
    provider: PaymentProviderSchema.default('stripe'),
    description: z.string().max(500).optional(),
    metadata: z.record(z.string()).optional(),
  })
  .strict();

export type CreatePaymentIntentBody = z.infer<typeof CreatePaymentIntentBodySchema>;

export const PaymentIntentResponseSchema = z
  .object({
    intentId: z.string().min(1),
    clientSecret: z.string().min(1).optional().describe('Client secret for Stripe; absent for Square'),
    provider: PaymentProviderSchema,
    amountCents: z.number().int().positive(),
    currency: z.string().length(3),
    status: z.enum(['requires_payment_method', 'requires_confirmation', 'succeeded', 'canceled']),
    createdAt: z.string().datetime(),
  })
  .strict();

export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;

// ---------------------------------------------------------------------------
// Payment history (GET /api/payments/history)
// ---------------------------------------------------------------------------

export const PaymentEventSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string().min(1),
    siteId: z.string().min(1).optional(),
    provider: PaymentProviderSchema,
    intentId: z.string().min(1),
    amountCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
    status: z.enum(['pending', 'succeeded', 'failed', 'refunded']),
    description: z.string().max(500).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type PaymentEvent = z.infer<typeof PaymentEventSchema>;

export const PaymentHistoryResponseSchema = z
  .object({
    events: z.array(PaymentEventSchema),
    count: z.number().int().nonnegative(),
    page: z.number().int().nonnegative(),
    pageSize: z.number().int().positive(),
  })
  .strict();

export type PaymentHistoryResponse = z.infer<typeof PaymentHistoryResponseSchema>;

// ---------------------------------------------------------------------------
// Query params for history endpoint
// ---------------------------------------------------------------------------

export const PaymentHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().nonnegative().default(0),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    provider: PaymentProviderSchema.optional(),
    status: z.enum(['pending', 'succeeded', 'failed', 'refunded']).optional(),
  })
  .strict();

export type PaymentHistoryQuery = z.infer<typeof PaymentHistoryQuerySchema>;
