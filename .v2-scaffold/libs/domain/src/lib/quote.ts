/**
 * Quote SSOT — editable prefill produced before a booking is confirmed.
 * Supports per-day overrides for multi-day jobs.
 */
import { z } from 'zod';
import { BookingDaySchema } from './booking.js';

export const QuoteLineItemSchema = z
  .object({
    label: z.string().min(1).max(200),
    qty: z.number().positive(),
    unit_cents: z.number().int().nonnegative(),
    taxable: z.boolean(),
  })
  .strict();

export type QuoteLineItem = z.infer<typeof QuoteLineItemSchema>;

export const QuoteDayOverrideSchema = BookingDaySchema.extend({
  fare_cents: z.number().int().nonnegative().nullable(),
  surge_multiplier: z.number().positive().nullable(),
  crew_size: z.number().int().positive().nullable(),
}).strict();

export type QuoteDayOverride = z.infer<typeof QuoteDayOverrideSchema>;

export const QuoteSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    customer_id: z.string().min(1),
    line_items: z.array(QuoteLineItemSchema).min(1),
    day_overrides: z.array(QuoteDayOverrideSchema).default([]),
    subtotal_cents: z.number().int().nonnegative(),
    tax_cents: z.number().int().nonnegative(),
    total_cents: z.number().int().nonnegative(),
    currency: z.string().length(3),
    expires_at: z.iso.datetime({ offset: true }),
    accepted_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

export type Quote = z.infer<typeof QuoteSchema>;
