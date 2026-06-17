/**
 * @module libs/features/native_booking_engine/handlers
 * @description Hono routes for the Native Booking Engine feature module.
 *
 * | Method | Path                          | Purpose                              |
 * | ------ | ----------------------------- | ------------------------------------ |
 * | GET    | /api/booking/slots            | List available slots for the org     |
 * | POST   | /api/booking/reserve          | Reserve a slot (create appointment)  |
 * | DELETE | /api/booking/cancel/:id       | Cancel an appointment by id          |
 * | GET    | /api/booking/appointments     | List all appointments (owner view)   |
 *
 * All routes return 404 when the `native_booking_engine` flag is off (never 403
 * — do not leak feature existence) per [[feature-flags]].
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types/env.js';
import { isFlagOn } from '../../../src/modules/feature_flags/services.js';
import { FLAG_KEY, getAvailableSlots, reserveSlot, cancelAppointment, listAppointments } from './service.js';
import {
  ReserveBookingBodySchema,
  SlotsResponseSchema,
  ReserveResponseSchema,
  AppointmentsResponseSchema,
  CancelResponseSchema,
} from './schemas.js';

type AppContext = { Bindings: Env; Variables: Variables };

export const nativeBookingEngine = new Hono<AppContext>();

const unauthorized = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } }, 401);

const notFound = (c: import('hono').Context<AppContext>) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

/** Auth + flag gate. Returns a Response to short-circuit, or null to proceed. */
async function guard(c: import('hono').Context<AppContext>): Promise<Response | null> {
  const userId = c.get('userId');
  if (!userId) return unauthorized(c);
  const on = await isFlagOn(c.env, FLAG_KEY, { userId, orgId: c.get('orgId') });
  if (!on) return notFound(c);
  return null;
}

/** GET /api/booking/slots — list available slots for the caller org. */
nativeBookingEngine.get('/api/booking/slots', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'BAD_REQUEST', message: 'No org context' } }, 400);

  const slots = await getAvailableSlots(c.env, orgId);
  return c.json(SlotsResponseSchema.parse({ slots, count: slots.length }));
});

/** POST /api/booking/reserve — reserve a slot (create appointment). */
nativeBookingEngine.post('/api/booking/reserve', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'BAD_REQUEST', message: 'No org context' } }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = ReserveBookingBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: parsed.error.issues } },
      422,
    );
  }

  const { slot_id, visitor_name, visitor_email, notes } = parsed.data;
  const appointment = await reserveSlot(c.env, orgId, slot_id, visitor_name, visitor_email, notes);

  if (!appointment) {
    return c.json(
      { error: { code: 'SLOT_UNAVAILABLE', message: 'Slot is full or does not exist' } },
      409,
    );
  }

  return c.json(ReserveResponseSchema.parse({ appointment }), 201);
});

/** DELETE /api/booking/cancel/:id — cancel a confirmed appointment. */
nativeBookingEngine.delete('/api/booking/cancel/:id', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'BAD_REQUEST', message: 'No org context' } }, 400);

  const id = c.req.param('id');
  const cancelled = await cancelAppointment(c.env, orgId, id);

  if (!cancelled) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Appointment not found or already cancelled' } },
      404,
    );
  }

  return c.json(CancelResponseSchema.parse({ cancelled: true, id }));
});

/** GET /api/booking/appointments — list all appointments for the caller org. */
nativeBookingEngine.get('/api/booking/appointments', async (c) => {
  const blocked = await guard(c);
  if (blocked) return blocked;

  const orgId = c.get('orgId');
  if (!orgId) return c.json({ error: { code: 'BAD_REQUEST', message: 'No org context' } }, 400);

  const appointments = await listAppointments(c.env, orgId);
  return c.json(AppointmentsResponseSchema.parse({ appointments, count: appointments.length }));
});
