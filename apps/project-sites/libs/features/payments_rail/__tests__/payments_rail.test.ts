/**
 * Unit tests for libs/features/payments_rail/service.ts
 *
 * D1 is mocked via the prepare().bind().first()/all()/run() chain pattern.
 * KV is not exercised by this module (cart lives in storefront_ecommerce).
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// D1 mock factory
// ---------------------------------------------------------------------------

type MockD1Row = Record<string, unknown>;

function makeBoundStmt(rows: MockD1Row[], single: MockD1Row | null) {
  return {
    first: jest.fn<() => Promise<MockD1Row | null>>().mockResolvedValue(single),
    all: jest.fn<() => Promise<{ results: MockD1Row[] }>>().mockResolvedValue({ results: rows }),
    run: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function makeDb(
  queryMap: Record<string, { rows?: MockD1Row[]; single?: MockD1Row | null }>,
): { prepare: (sql: string) => { bind: (...args: unknown[]) => ReturnType<typeof makeBoundStmt> } } {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => {
        // Find first matching key (partial match on SQL substring).
        const key = Object.keys(queryMap).find((k) => sql.includes(k));
        const spec = key ? queryMap[key]! : { rows: [], single: null };
        return makeBoundStmt(spec.rows ?? [], spec.single ?? null);
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Module-level db mock wiring (dbQuery / dbQueryOne delegate to D1 prepare)
// ---------------------------------------------------------------------------

let mockDb: ReturnType<typeof makeDb>;

jest.mock('../../../../src/services/db.js', () => ({
  dbQuery: jest.fn(async (db: ReturnType<typeof makeDb>, sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql).bind(...args);
    const res = await stmt.all();
    return { data: res.results, error: null };
  }),
  dbQueryOne: jest.fn(async (db: ReturnType<typeof makeDb>, sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql).bind(...args);
    return stmt.first();
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { dbQuery, dbQueryOne } = await import('../../../../src/services/db.js') as any;

// ---------------------------------------------------------------------------
// Import service under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import {
  FLAG_KEY,
  getPaymentMethods,
  recordPaymentIntent,
  getPaymentHistory,
  getPaymentEventById,
} from '../service.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-test-001';

const METHOD_ROW = {
  id: 'method-001',
  provider: 'stripe',
  brand: 'visa',
  last4: '4242',
  expMonth: 12,
  expYear: 2028,
  isDefault: 1,
};

const EVENT_ROW = {
  id: 'evt-001',
  orgId: ORG_ID,
  siteId: null,
  provider: 'stripe',
  intentId: 'pi_abc123',
  amountCents: 4999,
  currency: 'usd',
  status: 'requires_payment_method',
  description: 'Test charge',
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('payments_rail/service — FLAG_KEY', () => {
  test('equals the module slug exactly', () => {
    expect(FLAG_KEY).toBe('payments_rail');
  });
});

describe('payments_rail/service — getPaymentMethods', () => {
  beforeEach(() => {
    mockDb = makeDb({
      payments_rail_methods: { rows: [METHOD_ROW], single: null },
    });
  });

  test('returns mapped payment methods for an org', async () => {
    dbQuery.mockImplementationOnce(async () => ({ data: [METHOD_ROW], error: null }));

    const env = { DB: mockDb } as never;
    const methods = await getPaymentMethods(env, ORG_ID);

    expect(methods).toHaveLength(1);
    expect(methods[0]).toMatchObject({
      id: 'method-001',
      provider: 'stripe',
      brand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2028,
      isDefault: 1,
    });
  });

  test('returns empty array when org has no methods', async () => {
    dbQuery.mockImplementationOnce(async () => ({ data: [], error: null }));

    const env = { DB: mockDb } as never;
    const methods = await getPaymentMethods(env, ORG_ID);

    expect(methods).toHaveLength(0);
  });

  test('returns empty array on DB error (graceful)', async () => {
    dbQuery.mockImplementationOnce(async () => {
      throw new Error('D1 failure');
    });

    const env = { DB: mockDb } as never;
    const methods = await getPaymentMethods(env, ORG_ID);

    expect(methods).toHaveLength(0);
  });
});

describe('payments_rail/service — recordPaymentIntent', () => {
  test('calls D1 prepare + bind + run with correct columns', async () => {
    const runSpy = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const bindSpy = jest.fn(() => ({ run: runSpy }));
    const prepareSpy = jest.fn(() => ({ bind: bindSpy }));

    const env = { DB: { prepare: prepareSpy } } as never;

    await recordPaymentIntent(env, {
      id: 'evt-new',
      orgId: ORG_ID,
      provider: 'stripe',
      intentId: 'pi_new',
      amountCents: 9900,
      currency: 'usd',
      status: 'requires_payment_method',
    });

    expect(prepareSpy).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO payments_rail_events'),
    );
    expect(bindSpy).toHaveBeenCalledWith(
      'evt-new',
      ORG_ID,
      null,         // siteId
      'stripe',
      'pi_new',
      9900,
      'usd',
      null,         // description
      'requires_payment_method',
      expect.any(String), // created_at
      expect.any(String), // updated_at
    );
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  test('forwards siteId and description when provided', async () => {
    const bindSpy = jest.fn(() => ({ run: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) }));
    const prepareSpy = jest.fn(() => ({ bind: bindSpy }));

    const env = { DB: { prepare: prepareSpy } } as never;

    await recordPaymentIntent(env, {
      id: 'evt-full',
      orgId: ORG_ID,
      siteId: 'site-123',
      provider: 'square',
      intentId: 'sq_abc',
      amountCents: 2500,
      currency: 'usd',
      description: 'Membership fee',
      status: 'succeeded',
    });

    const callArgs = bindSpy.mock.calls[0]!;
    expect(callArgs[2]).toBe('site-123');
    expect(callArgs[7]).toBe('Membership fee');
  });
});

describe('payments_rail/service — getPaymentHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns paginated events with total count', async () => {
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 1 }));
    dbQuery.mockImplementationOnce(async () => ({ data: [EVENT_ROW], error: null }));

    const env = { DB: mockDb } as never;
    const result = await getPaymentHistory(env, ORG_ID, { page: 0, pageSize: 20 });

    expect(result.total).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: 'evt-001',
      orgId: ORG_ID,
      provider: 'stripe',
      intentId: 'pi_abc123',
      amountCents: 4999,
      currency: 'usd',
      status: 'requires_payment_method',
      description: 'Test charge',
    });
  });

  test('applies provider filter when provided', async () => {
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 0 }));
    dbQuery.mockImplementationOnce(async () => ({ data: [], error: null }));

    const env = { DB: mockDb } as never;
    const result = await getPaymentHistory(env, ORG_ID, { page: 0, pageSize: 20, provider: 'square' });

    expect(result.total).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  test('applies status filter when provided', async () => {
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 1 }));
    dbQuery.mockImplementationOnce(async () => ({ data: [EVENT_ROW], error: null }));

    const env = { DB: mockDb } as never;
    const result = await getPaymentHistory(env, ORG_ID, { page: 0, pageSize: 20, status: 'requires_payment_method' });

    expect(result.events[0]!.status).toBe('requires_payment_method');
  });

  test('returns empty result on D1 error (graceful)', async () => {
    dbQueryOne.mockImplementationOnce(async () => { throw new Error('DB down'); });
    dbQuery.mockImplementationOnce(async () => { throw new Error('DB down'); });

    const env = { DB: mockDb } as never;
    const result = await getPaymentHistory(env, ORG_ID, { page: 0, pageSize: 20 });

    expect(result.total).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  test('omits siteId and description when null in DB row', async () => {
    const rowWithNulls = { ...EVENT_ROW, siteId: null, description: null };
    dbQueryOne.mockImplementationOnce(async () => ({ cnt: 1 }));
    dbQuery.mockImplementationOnce(async () => ({ data: [rowWithNulls], error: null }));

    const env = { DB: mockDb } as never;
    const result = await getPaymentHistory(env, ORG_ID, { page: 0, pageSize: 20 });

    expect(result.events[0]!.siteId).toBeUndefined();
    expect(result.events[0]!.description).toBeUndefined();
  });
});

describe('payments_rail/service — getPaymentEventById', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns null when event not found', async () => {
    dbQueryOne.mockImplementationOnce(async () => null);

    const env = { DB: mockDb } as never;
    const result = await getPaymentEventById(env, 'non-existent');

    expect(result).toBeNull();
  });

  test('returns mapped PaymentEvent when found', async () => {
    dbQueryOne.mockImplementationOnce(async () => EVENT_ROW);

    const env = { DB: mockDb } as never;
    const event = await getPaymentEventById(env, 'evt-001');

    expect(event).not.toBeNull();
    expect(event!.id).toBe('evt-001');
    expect(event!.provider).toBe('stripe');
    expect(event!.amountCents).toBe(4999);
  });

  test('returns null on D1 error (graceful)', async () => {
    dbQueryOne.mockImplementationOnce(async () => { throw new Error('D1 connection lost'); });

    const env = { DB: mockDb } as never;
    const result = await getPaymentEventById(env, 'evt-001');

    expect(result).toBeNull();
  });
});
