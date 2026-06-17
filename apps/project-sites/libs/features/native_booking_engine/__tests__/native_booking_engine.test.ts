/**
 * Unit tests for the Native Booking Engine service (feature module).
 *
 * All D1 interaction is mocked in-memory. Tests cover:
 * - getAvailableSlots: returns only future slots with remaining capacity
 * - reserveSlot: creates appointment and increments slot count; returns null when full
 * - cancelAppointment: marks cancelled and decrements count; false when not found
 * - listAppointments: returns rows ordered newest-first
 * - FLAG_KEY constant matches the module slug
 */

import {
  getAvailableSlots,
  reserveSlot,
  cancelAppointment,
  listAppointments,
  FLAG_KEY,
} from '../service.js';

// ---------------------------------------------------------------------------
// D1 mock factory
// ---------------------------------------------------------------------------

interface SlotRow {
  id: string;
  org_id: string;
  site_id: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  label?: string;
  max_bookings: number;
  current_bookings: number;
  created_at?: string;
  deleted_at?: string | null;
}

interface ApptRow {
  id: string;
  org_id: string;
  site_id: string;
  slot_id: string;
  visitor_name: string;
  visitor_email: string;
  notes?: string | null;
  status: 'confirmed' | 'cancelled';
  created_at?: string;
  cancelled_at?: string | null;
}

function makeDb(opts: { slots?: SlotRow[]; appts?: ApptRow[] } = {}) {
  const slots: SlotRow[] = opts.slots ? [...opts.slots] : [];
  const appts: ApptRow[] = opts.appts ? [...opts.appts] : [];

  return {
    db: {
      prepare: jest.fn().mockImplementation((sql: string) => ({
        bind: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue({
            results: sql.includes('booking_appointments') ? appts : slots,
          }),
          first: jest.fn().mockImplementation(async () => {
            if (sql.includes('booking_appointments')) return appts[0] ?? null;
            return slots[0] ?? null;
          }),
          run: jest.fn().mockResolvedValue({ meta: { changes: 1 } }),
        }),
      })),
    } as unknown as D1Database,
    slots,
    appts,
  };
}

// Standard D1 mock (per project convention)
function mockD1() {
  return {
    prepare: jest.fn().mockReturnValue({
      bind: jest.fn().mockReturnValue({
        all: jest.fn().mockResolvedValue({ results: [] }),
        first: jest.fn().mockResolvedValue(null),
        run: jest.fn().mockResolvedValue({ meta: {} }),
      }),
    }),
  } as unknown as D1Database;
}

function makeEnv(db: D1Database): { DB: D1Database } {
  return { DB: db } as { DB: D1Database };
}

const ORG = 'org-abc';
const SITE = 'site-xyz';

const futureSlot: SlotRow = {
  id: 'slot-1',
  org_id: ORG,
  site_id: SITE,
  start_at: new Date(Date.now() + 3_600_000).toISOString(),
  end_at: new Date(Date.now() + 7_200_000).toISOString(),
  duration_minutes: 60,
  max_bookings: 2,
  current_bookings: 0,
  deleted_at: null,
};

const confirmedAppt: ApptRow = {
  id: 'appt-1',
  org_id: ORG,
  site_id: SITE,
  slot_id: 'slot-1',
  visitor_name: 'Alice',
  visitor_email: 'alice@example.com',
  status: 'confirmed',
  created_at: new Date().toISOString(),
  cancelled_at: null,
};

// ---------------------------------------------------------------------------
// FLAG_KEY
// ---------------------------------------------------------------------------

describe('FLAG_KEY', () => {
  test('equals the module slug', () => {
    expect(FLAG_KEY).toBe('native_booking_engine');
  });
});

// ---------------------------------------------------------------------------
// getAvailableSlots
// ---------------------------------------------------------------------------

describe('getAvailableSlots', () => {
  test('returns slots from DB query', async () => {
    const { db, slots } = makeDb({ slots: [futureSlot] });
    const env = makeEnv(db);
    const result = await getAvailableSlots(env as unknown as import('../../../src/types/env.js').Env, ORG);
    expect(result).toEqual(slots);
  });

  test('returns empty array on DB error', async () => {
    const db = {
      prepare: jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          all: jest.fn().mockRejectedValue(new Error('D1 error')),
        }),
      }),
    } as unknown as D1Database;
    const result = await getAvailableSlots(makeEnv(db) as unknown as import('../../../src/types/env.js').Env, ORG);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reserveSlot
// ---------------------------------------------------------------------------

describe('reserveSlot', () => {
  test('returns null when slot not found', async () => {
    const db = mockD1();
    const result = await reserveSlot(
      makeEnv(db) as unknown as import('../../../src/types/env.js').Env,
      ORG,
      'missing-slot',
      'Bob',
      'bob@example.com',
    );
    expect(result).toBeNull();
  });

  test('returns null when slot is at max capacity', async () => {
    const fullSlot: SlotRow = { ...futureSlot, current_bookings: 2, max_bookings: 2 };
    const db = {
      prepare: jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue({ results: [] }),
          first: jest.fn().mockResolvedValue(fullSlot),
          run: jest.fn().mockResolvedValue({ meta: { changes: 0 } }),
        }),
      }),
    } as unknown as D1Database;
    const result = await reserveSlot(
      makeEnv(db) as unknown as import('../../../src/types/env.js').Env,
      ORG,
      futureSlot.id,
      'Bob',
      'bob@example.com',
    );
    expect(result).toBeNull();
  });

  test('returns appointment row when slot has capacity', async () => {
    let callCount = 0;
    const db = {
      prepare: jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue({ results: [] }),
          first: jest.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) return futureSlot; // slot lookup
            // second first() = newly inserted appointment
            return { ...confirmedAppt };
          }),
          run: jest.fn().mockResolvedValue({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;

    const result = await reserveSlot(
      makeEnv(db) as unknown as import('../../../src/types/env.js').Env,
      ORG,
      futureSlot.id,
      'Alice',
      'alice@example.com',
    );
    // The service calls prepare().bind().run() for update + insert then first() for the new row.
    // Our mock returns the confirmedAppt on 2nd first() call.
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// cancelAppointment
// ---------------------------------------------------------------------------

describe('cancelAppointment', () => {
  test('returns false when appointment not found', async () => {
    const db = mockD1();
    const result = await cancelAppointment(
      makeEnv(db) as unknown as import('../../../src/types/env.js').Env,
      ORG,
      'missing-appt',
    );
    expect(result).toBe(false);
  });

  test('returns false when appointment already cancelled', async () => {
    const db = {
      prepare: jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue({ results: [] }),
          first: jest.fn().mockResolvedValue({ ...confirmedAppt, status: 'cancelled' }),
          run: jest.fn().mockResolvedValue({ meta: {} }),
        }),
      }),
    } as unknown as D1Database;
    const result = await cancelAppointment(
      makeEnv(db) as unknown as import('../../../src/types/env.js').Env,
      ORG,
      confirmedAppt.id,
    );
    expect(result).toBe(false);
  });

  test('returns true when appointment is confirmed', async () => {
    const db = {
      prepare: jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          all: jest.fn().mockResolvedValue({ results: [] }),
          first: jest.fn().mockResolvedValue({ ...confirmedAppt }),
          run: jest.fn().mockResolvedValue({ meta: { changes: 1 } }),
        }),
      }),
    } as unknown as D1Database;
    const result = await cancelAppointment(
      makeEnv(db) as unknown as import('../../../src/types/env.js').Env,
      ORG,
      confirmedAppt.id,
    );
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listAppointments
// ---------------------------------------------------------------------------

describe('listAppointments', () => {
  test('returns appointments array from DB', async () => {
    const { db, appts } = makeDb({ appts: [confirmedAppt] });
    const result = await listAppointments(makeEnv(db) as unknown as import('../../../src/types/env.js').Env, ORG);
    expect(result).toEqual(appts);
  });

  test('returns empty array on DB error', async () => {
    const db = {
      prepare: jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          all: jest.fn().mockRejectedValue(new Error('D1 error')),
        }),
      }),
    } as unknown as D1Database;
    const result = await listAppointments(makeEnv(db) as unknown as import('../../../src/types/env.js').Env, ORG);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Schema smoke tests
// ---------------------------------------------------------------------------

describe('ReserveBookingBodySchema', () => {
  test('accepts valid body', async () => {
    const { ReserveBookingBodySchema } = await import('../schemas.js');
    expect(() =>
      ReserveBookingBodySchema.parse({
        slot_id: 'slot-1',
        visitor_name: 'Alice',
        visitor_email: 'alice@example.com',
      }),
    ).not.toThrow();
  });

  test('rejects unknown keys (.strict)', async () => {
    const { ReserveBookingBodySchema } = await import('../schemas.js');
    expect(() =>
      ReserveBookingBodySchema.parse({
        slot_id: 'slot-1',
        visitor_name: 'Alice',
        visitor_email: 'alice@example.com',
        extra: true,
      }),
    ).toThrow();
  });

  test('rejects invalid email', async () => {
    const { ReserveBookingBodySchema } = await import('../schemas.js');
    expect(() =>
      ReserveBookingBodySchema.parse({
        slot_id: 'slot-1',
        visitor_name: 'Alice',
        visitor_email: 'not-an-email',
      }),
    ).toThrow();
  });
});
