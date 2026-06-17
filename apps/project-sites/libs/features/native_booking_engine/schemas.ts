/**
 * @module libs/features/native_booking_engine/schemas
 * @description Zod schemas for the Native Booking Engine feature module.
 * All request/response shapes are defined here and inferred for TypeScript types.
 * @packageDocumentation
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Domain schemas
// ---------------------------------------------------------------------------

/** A single availability slot offered by the tenant. */
export const BookingSlotSchema = z
  .object({
    id: z.string().min(1),
    org_id: z.string().min(1),
    site_id: z.string().min(1),
    start_at: z.string().min(1), // ISO 8601
    end_at: z.string().min(1),   // ISO 8601
    duration_minutes: z.number().int().positive(),
    label: z.string().optional(),
    max_bookings: z.number().int().positive().default(1),
    current_bookings: z.number().int().min(0).default(0),
    created_at: z.string().optional(),
  })
  .strict();

export type BookingSlot = z.infer<typeof BookingSlotSchema>;

/** A confirmed appointment created by a visitor. */
export const BookingAppointmentSchema = z
  .object({
    id: z.string().min(1),
    org_id: z.string().min(1),
    site_id: z.string().min(1),
    slot_id: z.string().min(1),
    visitor_name: z.string().min(1).max(200),
    visitor_email: z.string().email(),
    notes: z.string().max(2000).optional(),
    status: z.enum(['confirmed', 'cancelled']),
    created_at: z.string().optional(),
    cancelled_at: z.string().nullable().optional(),
  })
  .strict();

export type BookingAppointment = z.infer<typeof BookingAppointmentSchema>;

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/** Body for POST /api/booking/reserve */
export const ReserveBookingBodySchema = z
  .object({
    slot_id: z.string().min(1),
    visitor_name: z.string().min(1).max(200),
    visitor_email: z.string().email(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export type ReserveBookingBody = z.infer<typeof ReserveBookingBodySchema>;

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/** GET /api/booking/slots */
export const SlotsResponseSchema = z
  .object({
    slots: z.array(BookingSlotSchema),
    count: z.number().int().min(0),
  })
  .strict();

export type SlotsResponse = z.infer<typeof SlotsResponseSchema>;

/** POST /api/booking/reserve */
export const ReserveResponseSchema = z
  .object({
    appointment: BookingAppointmentSchema,
  })
  .strict();

export type ReserveResponse = z.infer<typeof ReserveResponseSchema>;

/** GET /api/booking/appointments */
export const AppointmentsResponseSchema = z
  .object({
    appointments: z.array(BookingAppointmentSchema),
    count: z.number().int().min(0),
  })
  .strict();

export type AppointmentsResponse = z.infer<typeof AppointmentsResponseSchema>;

/** DELETE /api/booking/cancel/:id */
export const CancelResponseSchema = z
  .object({
    cancelled: z.boolean(),
    id: z.string().min(1),
  })
  .strict();

export type CancelResponse = z.infer<typeof CancelResponseSchema>;
