/**
 * Unit tests for libs/features/payments_rail/service.ts
 *
 * D1 is mocked at the dbQuery/dbQueryOne boundary level.
 * recordPaymentIntent uses raw D1 directly; those tests spy on prepare/bind/run.
 */

// ---------------------------------------------------------------------------
// Captured mocks for per-test override
// ---------------------------------------------------------------------------

const mockDbQuery = jest.fn();
const mockDbQueryOne = jest.fn();

jest.mock('../../../../src/services/db.js', () => ({
  dbQuery: (...a: unknown[]) => mockDbQuery(...a),
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
}));

jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

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

const MOCK_DB = {} as never;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('payments_rail/service — FLAG_KEY', () => {
  test('equals the module slug exactly', () => {
    expect(FLAG_KEY).toBe('payments_rail');
  });
});

describe('payments_rail/service — getPaymentMethods', () => {
  test('returns mapped payment methods for an org', async () => {
    mockDbQuery.mockResolvedValueOnce({ data: [METHOD_ROW] });

    const env = { DB: MOCK_DB } as never;
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
    mockDbQuery.mockResolvedValueOnce({ data: [] });

    const env = { DB: MOCK_DB } as never;
    const methods = await getPaymentMethods(env, ORG_ID);

    expect(methods).toHaveLength(0);
  });

  test('returns empty array on DB error (graceful)', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('D1 failure'));

    const env = { DB: MOCK_DB } as never;
    const methods = await getPaymentMethods(env, ORG_ID);

    expect(methods).toHaveLength(0);
  });
});

describe('payments_rail/service — recordPaymentIntent', () => {
  test('calls D1 prepare + bind + run with correct columns', async () => {
    const runSpy = jest.fn().mockResolvedValue(undefined);
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
      null, // siteId
      'stripe',
      'pi_new',
      9900,
      'usd',
      null, // description
      'requires_payment_method',
      expect.any(String), // created_at
      expect.any(String), // updated_at
    );
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  test('forwards siteId and description when provided', async () => {
    const bindSpy = jest.fn(() => ({ run: jest.fn().mockResolvedValue(undefined) }));
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
  test('returns paginated events with total count', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ cnt: 1 });
    mockDbQuery.mockResolvedValueOnce({ data: [EVENT_ROW] });

    const env = { DB: MOCK_DB } as never;
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
    mockDbQueryOne.mockResolvedValueOnce({ cnt: 0 });
    mockDbQuery.mockResolvedValueOnce({ data: [] });

    const env = { DB: MOCK_DB } as never;
    const result = await getPaymentHistory(env, ORG_ID, {
      page: 0,
      pageSize: 20,
      provider: 'square',
    });

    expect(result.total).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  test('applies status filter when provided', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ cnt: 1 });
    mockDbQuery.mockResolvedValueOnce({ data: [EVENT_ROW] });

    const env = { DB: MOCK_DB } as never;
    const result = await getPaymentHistory(env, ORG_ID, {
      page: 0,
      pageSize: 20,
      status: 'requires_payment_method',
    });

    expect(result.events[0]!.status).toBe('requires_payment_method');
  });

  test('returns empty result on D1 error (graceful)', async () => {
    mockDbQueryOne.mockRejectedValueOnce(new Error('DB down'));
    mockDbQuery.mockResolvedValueOnce({ data: [] });

    const env = { DB: MOCK_DB } as never;
    const result = await getPaymentHistory(env, ORG_ID, { page: 0, pageSize: 20 });

    expect(result.total).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  test('omits siteId and description when null in DB row', async () => {
    const rowWithNulls = { ...EVENT_ROW, siteId: null, description: null };
    mockDbQueryOne.mockResolvedValueOnce({ cnt: 1 });
    mockDbQuery.mockResolvedValueOnce({ data: [rowWithNulls] });

    const env = { DB: MOCK_DB } as never;
    const result = await getPaymentHistory(env, ORG_ID, { page: 0, pageSize: 20 });

    expect(result.events[0]!.siteId).toBeUndefined();
    expect(result.events[0]!.description).toBeUndefined();
  });
});

describe('payments_rail/service — getPaymentEventById', () => {
  test('returns null when event not found', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);

    const env = { DB: MOCK_DB } as never;
    const result = await getPaymentEventById(env, 'non-existent');

    expect(result).toBeNull();
  });

  test('returns mapped PaymentEvent when found', async () => {
    mockDbQueryOne.mockResolvedValueOnce(EVENT_ROW);

    const env = { DB: MOCK_DB } as never;
    const event = await getPaymentEventById(env, 'evt-001');

    expect(event).not.toBeNull();
    expect(event!.id).toBe('evt-001');
    expect(event!.provider).toBe('stripe');
    expect(event!.amountCents).toBe(4999);
  });

  test('returns null on D1 error (graceful)', async () => {
    mockDbQueryOne.mockRejectedValueOnce(new Error('D1 connection lost'));

    const env = { DB: MOCK_DB } as never;
    const result = await getPaymentEventById(env, 'evt-001');

    expect(result).toBeNull();
  });
});
