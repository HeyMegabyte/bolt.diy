/**
 * @module libs/features/native_booking_engine/service
 * @description Business logic for the Native Booking Engine feature module.
 *
 * Provides slot availability queries and appointment CRUD over D1.
 * Uses the shared `dbQuery` / `dbQueryOne` helpers — no raw D1 calls in handlers.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import type {
  BookingSlot,
  BookingAppointment,
} from './schemas.js';

/** Feature flag key gating this module. */
export const FLAG_KEY = 'native_booking_engine';

/**
 * Return available booking slots for an org (future slots with remaining capacity).
 *
 * @param env   - Worker env (uses `env.DB`).
 * @param orgId - Org to query.
 * @returns Array of available {@link BookingSlot} rows.
 */
export async function getAvailableSlots(
  env: Env,
  orgId: string,
): Promise<BookingSlot[]> {
  const { data } = await dbQuery<BookingSlot>(
    env.DB,
    `SELECT id, org_id, site_id, start_at, end_at, duration_minutes,
            label, max_bookings, current_bookings, created_at
     FROM booking_slots
     WHERE org_id = ?
       AND start_at > datetime('now')
       AND current_bookings < max_bookings
       AND deleted_at IS NULL
     ORDER BY start_at ASC
     LIMIT 100`,
    [orgId],
  ).catch(() => ({ data: [] as BookingSlot[] }));
  return data;
}

/**
 * Reserve an appointment for a slot.
 *
 * Atomically increments `current_bookings` on the slot and inserts
 * a `confirmed` appointment row.  Returns null when the slot is full
 * or does not belong to the org.
 *
 * @param env          - Worker env.
 * @param orgId        - Org that owns the slot.
 * @param slotId       - Target slot id.
 * @param visitorName  - Visitor display name.
 * @param visitorEmail - Visitor email address.
 * @param notes        - Optional visitor notes.
 * @returns Created {@link BookingAppointment} or null on conflict.
 */
export async function reserveSlot(
  env: Env,
  orgId: string,
  slotId: string,
  visitorName: string,
  visitorEmail: string,
  notes?: string,
): Promise<BookingAppointment | null> {
  // Verify the slot exists and belongs to the org with capacity remaining.
  const slot = await dbQueryOne<{ id: string; max_bookings: number; current_bookings: number }>(
    env.DB,
    `SELECT id, max_bookings, current_bookings
     FROM booking_slots
     WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
    [slotId, orgId],
  ).catch(() => null);

  if (!slot || slot.current_bookings >= slot.max_bookings) return null;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Increment slot booking count.
  await env.DB.prepare(
    `UPDATE booking_slots
     SET current_bookings = current_bookings + 1, updated_at = ?
     WHERE id = ? AND current_bookings < max_bookings`,
  )
    .bind(now, slotId)
    .run()
    .catch(() => null);

  // Insert the appointment row.
  await env.DB.prepare(
    `INSERT INTO booking_appointments
       (id, org_id, site_id, slot_id, visitor_name, visitor_email, notes, status, created_at)
     SELECT ?, org_id, site_id, id, ?, ?, ?, 'confirmed', ?
     FROM booking_slots WHERE id = ?`,
  )
    .bind(id, visitorName, visitorEmail, notes ?? null, now, slotId)
    .run()
    .catch(() => null);

  return dbQueryOne<BookingAppointment>(
    env.DB,
    `SELECT id, org_id, site_id, slot_id, visitor_name, visitor_email,
            notes, status, created_at, cancelled_at
     FROM booking_appointments WHERE id = ?`,
    [id],
  ).catch(() => null);
}

/**
 * Cancel a confirmed appointment by id.
 *
 * Decrements the slot's `current_bookings` and marks the appointment cancelled.
 * Returns false when the appointment does not exist or already cancelled.
 *
 * @param env   - Worker env.
 * @param orgId - Org that owns the appointment (scoping guard).
 * @param id    - Appointment id to cancel.
 */
export async function cancelAppointment(
  env: Env,
  orgId: string,
  id: string,
): Promise<boolean> {
  const appt = await dbQueryOne<{ id: string; slot_id: string; status: string }>(
    env.DB,
    `SELECT id, slot_id, status FROM booking_appointments
     WHERE id = ? AND org_id = ?`,
    [id, orgId],
  ).catch(() => null);

  if (!appt || appt.status === 'cancelled') return false;

  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE booking_appointments SET status = 'cancelled', cancelled_at = ? WHERE id = ?`,
  )
    .bind(now, id)
    .run()
    .catch(() => null);

  await env.DB.prepare(
    `UPDATE booking_slots
     SET current_bookings = MAX(0, current_bookings - 1), updated_at = ?
     WHERE id = ?`,
  )
    .bind(now, appt.slot_id)
    .run()
    .catch(() => null);

  return true;
}

/**
 * List all appointments for an org (owner view).
 *
 * @param env   - Worker env.
 * @param orgId - Org to query.
 * @returns Array of {@link BookingAppointment} rows, newest first.
 */
export async function listAppointments(
  env: Env,
  orgId: string,
): Promise<BookingAppointment[]> {
  const { data } = await dbQuery<BookingAppointment>(
    env.DB,
    `SELECT id, org_id, site_id, slot_id, visitor_name, visitor_email,
            notes, status, created_at, cancelled_at
     FROM booking_appointments
     WHERE org_id = ?
     ORDER BY created_at DESC
     LIMIT 200`,
    [orgId],
  ).catch(() => ({ data: [] as BookingAppointment[] }));
  return data;
}
