/**
 * Booking SSOT. Mirrors D1 `calendar_bookings` for service-oriented
 * tenants (crew dispatch, hauling, cleaning, etc.).
 */
import { z } from 'zod';

export const BookingStatusSchema = z.enum([
  'pending',
  'confirmed',
  'rescheduled',
  'cancelled',
  'completed',
  'no_show',
] as const);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const BookingSchema = z
  .object({
    id: z.string().min(1),
    tenant_id: z.string().min(1),
    customer_id: z.string().min(1),
    crew_id: z.string().min(1).nullable(),
    status: BookingStatusSchema,
    scheduled_for: z.iso.datetime({ offset: true }),
    duration_min: z.number().int().positive(),
    fare_cents: z.number().int().nonnegative(),
    surge_multiplier: z.number().positive().default(1),
    notes: z.string().max(2000).nullable(),
    created_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type Booking = z.infer<typeof BookingSchema>;

export const BookingDaySchema = z
  .object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((d) => new Date(d.end).getTime() > new Date(d.start).getTime(), {
    message: 'end must be after start',
  });

export type BookingDay = z.infer<typeof BookingDaySchema>;

/**
 * Multi-day bookings (e.g. multi-day cleaning, long-haul moves).
 *
 * @example
 * ```ts
 * MultiDayBookingSchema.parse({
 *   ...baseBooking,
 *   days: [
 *     { start: '2026-06-01T09:00:00-04:00', end: '2026-06-01T17:00:00-04:00' },
 *     { start: '2026-06-02T09:00:00-04:00', end: '2026-06-02T17:00:00-04:00' },
 *   ],
 * });
 * ```
 */
export const MultiDayBookingSchema = BookingSchema.extend({
  days: z.array(BookingDaySchema).min(1),
}).strict();

export type MultiDayBooking = z.infer<typeof MultiDayBookingSchema>;
