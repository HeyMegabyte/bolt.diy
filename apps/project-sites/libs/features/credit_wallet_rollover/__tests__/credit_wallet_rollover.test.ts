import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── D1 mock factory ──────────────────────────────────────────────────────────
function makeDb(overrides: Record<string, unknown> = {}) {
  const stmt = {
    bind: jest.fn().mockReturnValue({
      all: jest.fn().mockResolvedValue({ results: [] }),
      first: jest.fn().mockResolvedValue(null),
      run: jest.fn().mockResolvedValue({ meta: {} }),
      ...overrides,
    }),
  };
  return {
    prepare: jest.fn().mockReturnValue(stmt),
    _stmt: stmt,
  } as unknown as D1Database;
}

// ── Module-level mocks ───────────────────────────────────────────────────────
jest.mock('../../../src/services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
}));

jest.mock('../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));

import { dbQuery, dbQueryOne } from '../../../src/services/db.js';
import {
  FLAG_KEY,
  DEFAULT_MONTHLY_ALLOWANCE,
  ROLLOVER_CAP_MULTIPLIER,
  resolveMonthlyAllowance,
  getBalance,
  applyCredits,
  processMonthlyRollover,
  getCreditHistory,
} from '../service.js';
import {
  ApplyCreditsBodySchema,
  CreditKindSchema,
  CreditLedgerRowSchema,
  CreditBalanceResponseSchema,
  ApplyCreditsResponseSchema,
  CreditHistoryResponseSchema,
} from '../schemas.js';

const mockDbQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockDbQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;

// ── Helpers ──────────────────────────────────────────────────────────────────
function makeEnv(dbOverride?: D1Database) {
  return {
    DB: dbOverride ?? makeDb(),
  } as unknown as import('../../../src/types/env.js').Env;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLAG_KEY
// ─────────────────────────────────────────────────────────────────────────────
describe('FLAG_KEY', () => {
  it('equals credit_wallet_rollover', () => {
    expect(FLAG_KEY).toBe('credit_wallet_rollover');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
describe('constants', () => {
  it('DEFAULT_MONTHLY_ALLOWANCE is 100', () => {
    expect(DEFAULT_MONTHLY_ALLOWANCE).toBe(100);
  });

  it('ROLLOVER_CAP_MULTIPLIER is 3', () => {
    expect(ROLLOVER_CAP_MULTIPLIER).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveMonthlyAllowance
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveMonthlyAllowance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns monthly_credits from the subscriptions row when found', async () => {
    const db = makeDb();
    mockDbQueryOne.mockResolvedValueOnce({ monthly_credits: 250 });
    const result = await resolveMonthlyAllowance(db, 'org-1');
    expect(result).toBe(250);
  });

  it('falls back to DEFAULT_MONTHLY_ALLOWANCE when no subscription row', async () => {
    const db = makeDb();
    mockDbQueryOne.mockResolvedValueOnce(null);
    const result = await resolveMonthlyAllowance(db, 'org-1');
    expect(result).toBe(DEFAULT_MONTHLY_ALLOWANCE);
  });

  it('falls back to DEFAULT_MONTHLY_ALLOWANCE when monthly_credits is null', async () => {
    const db = makeDb();
    mockDbQueryOne.mockResolvedValueOnce({ monthly_credits: null });
    const result = await resolveMonthlyAllowance(db, 'org-1');
    expect(result).toBe(DEFAULT_MONTHLY_ALLOWANCE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBalance
// ─────────────────────────────────────────────────────────────────────────────
describe('getBalance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the sum of all ledger amounts', async () => {
    const db = makeDb();
    mockDbQueryOne.mockResolvedValueOnce({ total: 350 });
    const balance = await getBalance(db, 'org-1');
    expect(balance).toBe(350);
  });

  it('returns 0 when the ledger is empty (null total)', async () => {
    const db = makeDb();
    mockDbQueryOne.mockResolvedValueOnce({ total: null });
    const balance = await getBalance(db, 'org-1');
    expect(balance).toBe(0);
  });

  it('never returns a negative balance', async () => {
    const db = makeDb();
    mockDbQueryOne.mockResolvedValueOnce({ total: -50 });
    const balance = await getBalance(db, 'org-1');
    expect(balance).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyCredits
// ─────────────────────────────────────────────────────────────────────────────
describe('applyCredits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('debits the requested amount when sufficient balance exists', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    // idempotency check returns no prior row
    mockDbQueryOne.mockResolvedValueOnce(null);
    // current balance
    mockDbQueryOne.mockResolvedValueOnce({ total: 200 });
    // insert ledger row
    mockDbQueryOne.mockResolvedValueOnce({ id: 'ledger-1', balance_after: 150 });

    const result = await applyCredits(env, 'org-1', 50, 'seat charge');
    expect(result.applied).toBe(50);
    expect(result.balance).toBe(150);
    expect(result.ledgerId).toBe('ledger-1');
  });

  it('caps debit at available balance when amount exceeds balance', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    // no prior idempotency key
    mockDbQueryOne.mockResolvedValueOnce(null);
    // balance is only 30
    mockDbQueryOne.mockResolvedValueOnce({ total: 30 });
    // insert returns row with new balance 0
    mockDbQueryOne.mockResolvedValueOnce({ id: 'ledger-2', balance_after: 0 });

    const result = await applyCredits(env, 'org-1', 100, 'over-spend');
    expect(result.applied).toBe(30);
  });

  it('returns the prior ledger row when idempotency key matches', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    // idempotency check returns existing row
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'ledger-existing',
      balance_after: 80,
      amount: -20,
    });

    const result = await applyCredits(env, 'org-1', 20, 'retry', 'idem-key-123');
    expect(result.applied).toBe(20);
    expect(result.ledgerId).toBe('ledger-existing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processMonthlyRollover
// ─────────────────────────────────────────────────────────────────────────────
describe('processMonthlyRollover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('grants the full monthly allowance when wallet is empty', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    // monthly_credits from subscription
    mockDbQueryOne.mockResolvedValueOnce({ monthly_credits: 100 });
    // current balance = 0
    mockDbQueryOne.mockResolvedValueOnce({ total: 0 });
    // insert rollover row
    mockDbQueryOne.mockResolvedValueOnce({ id: 'rollover-1', balance_after: 100 });

    const granted = await processMonthlyRollover(env, 'org-1');
    expect(granted).toBe(100);
  });

  it('caps total balance at 3x the monthly allowance', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    // allowance = 100, cap = 300
    mockDbQueryOne.mockResolvedValueOnce({ monthly_credits: 100 });
    // current balance is already 250
    mockDbQueryOne.mockResolvedValueOnce({ total: 250 });
    // grant = min(250+100, 300) - 250 = 50
    mockDbQueryOne.mockResolvedValueOnce({ id: 'rollover-2', balance_after: 300 });

    const granted = await processMonthlyRollover(env, 'org-1');
    expect(granted).toBe(50);
  });

  it('grants nothing when balance is already at the cap', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    mockDbQueryOne.mockResolvedValueOnce({ monthly_credits: 100 });
    // already at cap
    mockDbQueryOne.mockResolvedValueOnce({ total: 300 });

    const granted = await processMonthlyRollover(env, 'org-1');
    expect(granted).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCreditHistory
// ─────────────────────────────────────────────────────────────────────────────
describe('getCreditHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ledger rows newest-first', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    const rows = [
      {
        id: 'row-2',
        org_id: 'org-1',
        kind: 'applied',
        amount: -50,
        balance_after: 50,
        description: 'usage',
        idempotency_key: null,
        created_at: '2026-06-17T12:00:00Z',
      },
      {
        id: 'row-1',
        org_id: 'org-1',
        kind: 'earned',
        amount: 100,
        balance_after: 100,
        description: 'initial',
        idempotency_key: null,
        created_at: '2026-06-01T00:00:00Z',
      },
    ];
    mockDbQuery.mockResolvedValueOnce(rows);

    const result = await getCreditHistory(env, 'org-1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('row-2');
    expect(result[1].id).toBe('row-1');
  });

  it('returns an empty array when there is no history', async () => {
    const db = makeDb();
    const env = makeEnv(db);
    mockDbQuery.mockResolvedValueOnce([]);

    const result = await getCreditHistory(env, 'org-1');
    expect(result).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema smoke tests
// ─────────────────────────────────────────────────────────────────────────────
describe('CreditKindSchema', () => {
  it('accepts all four valid kinds', () => {
    for (const kind of ['earned', 'rollover', 'applied', 'expired']) {
      expect(CreditKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects unknown values', () => {
    expect(() => CreditKindSchema.parse('bonus')).toThrow();
  });
});

describe('ApplyCreditsBodySchema', () => {
  it('accepts a valid body', () => {
    const body = { amount: 10, description: 'test debit' };
    expect(() => ApplyCreditsBodySchema.parse(body)).not.toThrow();
  });

  it('accepts optional idempotency_key', () => {
    const body = { amount: 5, idempotency_key: 'key-abc' };
    expect(() => ApplyCreditsBodySchema.parse(body)).not.toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    const body = { amount: 10, extra: 'nope' };
    expect(() => ApplyCreditsBodySchema.parse(body)).toThrow();
  });

  it('rejects non-positive amounts', () => {
    expect(() => ApplyCreditsBodySchema.parse({ amount: 0 })).toThrow();
    expect(() => ApplyCreditsBodySchema.parse({ amount: -5 })).toThrow();
  });

  it('rejects non-integer amounts', () => {
    expect(() => ApplyCreditsBodySchema.parse({ amount: 1.5 })).toThrow();
  });
});

describe('CreditLedgerRowSchema', () => {
  it('accepts a valid ledger row', () => {
    const row = {
      id: 'abc-123',
      org_id: 'org-1',
      kind: 'earned',
      amount: 100,
      balance_after: 100,
      description: null,
      idempotency_key: null,
      created_at: '2026-06-01T00:00:00Z',
    };
    expect(() => CreditLedgerRowSchema.parse(row)).not.toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    const row = {
      id: 'abc-123',
      org_id: 'org-1',
      kind: 'earned',
      amount: 100,
      balance_after: 100,
      description: null,
      idempotency_key: null,
      created_at: '2026-06-01T00:00:00Z',
      unexpected_field: true,
    };
    expect(() => CreditLedgerRowSchema.parse(row)).toThrow();
  });
});

describe('CreditBalanceResponseSchema', () => {
  it('accepts a valid balance response', () => {
    const resp = {
      org_id: 'org-1',
      balance: 75,
      monthly_allowance: 100,
      rollover_cap: 300,
    };
    expect(() => CreditBalanceResponseSchema.parse(resp)).not.toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      CreditBalanceResponseSchema.parse({
        org_id: 'org-1',
        balance: 0,
        monthly_allowance: 100,
        rollover_cap: 300,
        extra: 1,
      }),
    ).toThrow();
  });
});

describe('ApplyCreditsResponseSchema', () => {
  it('accepts a valid apply response', () => {
    const resp = { applied: 10, balance: 90, ledger_id: 'row-1' };
    expect(() => ApplyCreditsResponseSchema.parse(resp)).not.toThrow();
  });
});

describe('CreditHistoryResponseSchema', () => {
  it('accepts a valid history response with empty rows', () => {
    const resp = { org_id: 'org-1', rows: [], count: 0 };
    expect(() => CreditHistoryResponseSchema.parse(resp)).not.toThrow();
  });
});
