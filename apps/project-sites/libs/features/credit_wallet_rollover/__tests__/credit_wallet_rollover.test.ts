import { describe, it, expect } from '@jest/globals';

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

// ── D1 stub ──────────────────────────────────────────────────────────────────
// No module mock. The @swc/jest jest.mock hoist does NOT reliably intercept
// `src/services/db.js` from this file (see _LOOP_LEDGER fire-v2.40 — payments_rail
// uses the byte-identical mock yet intercepts, this file never did). Instead we
// pass a fake D1Database and let the REAL dbQuery/dbQueryOne run against it —
// the pattern proven in native_booking_engine + referral_loop.
//
// dbQuery/dbQueryOne both read via `.all()` and the `results` array (dbQueryOne
// returns results[0]). So the stub returns a queued `{ results }` per `.all()`
// call, in the order the service issues its SELECTs. `.run()` (INSERTs) does
// not consume from the queue.
function makeDb(allResults: Array<{ results: unknown[] }> = []) {
  let i = 0;
  const stmt = {
    bind: () => stmt,
    all: async () => allResults[i++] ?? { results: [] },
    run: async () => ({ meta: { changes: 1 } }),
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

function makeEnv(db: D1Database) {
  return { DB: db } as unknown as import('../../../../src/types/env.js').Env;
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
// resolveMonthlyAllowance — one SELECT on subscriptions
// ─────────────────────────────────────────────────────────────────────────────
describe('resolveMonthlyAllowance', () => {
  it('returns monthly_credits from the subscriptions row when found', async () => {
    const db = makeDb([{ results: [{ monthly_credits: 250 }] }]);
    expect(await resolveMonthlyAllowance(db, 'org-1')).toBe(250);
  });

  it('falls back to DEFAULT_MONTHLY_ALLOWANCE when no subscription row', async () => {
    const db = makeDb([{ results: [] }]);
    expect(await resolveMonthlyAllowance(db, 'org-1')).toBe(DEFAULT_MONTHLY_ALLOWANCE);
  });

  it('falls back to DEFAULT_MONTHLY_ALLOWANCE when monthly_credits is null', async () => {
    const db = makeDb([{ results: [{ monthly_credits: null }] }]);
    expect(await resolveMonthlyAllowance(db, 'org-1')).toBe(DEFAULT_MONTHLY_ALLOWANCE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getBalance — one SELECT SUM(amount) on the ledger
// ─────────────────────────────────────────────────────────────────────────────
describe('getBalance', () => {
  it('returns the sum of all ledger amounts', async () => {
    const db = makeDb([{ results: [{ total: 350 }] }]);
    expect(await getBalance(db, 'org-1')).toBe(350);
  });

  it('returns 0 when the ledger is empty (null total)', async () => {
    const db = makeDb([{ results: [{ total: null }] }]);
    expect(await getBalance(db, 'org-1')).toBe(0);
  });

  it('never returns a negative balance', async () => {
    const db = makeDb([{ results: [{ total: -50 }] }]);
    expect(await getBalance(db, 'org-1')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// applyCredits
// ─────────────────────────────────────────────────────────────────────────────
describe('applyCredits', () => {
  it('debits the requested amount when sufficient balance exists', async () => {
    // No idempotency key → getBalance SELECT (total 200), then INSERT (.run()).
    const env = makeEnv(makeDb([{ results: [{ total: 200 }] }]));
    const result = await applyCredits(env, 'org-1', 50, 'seat charge');
    expect(result.applied).toBe(50);
    expect(result.balance).toBe(150);
    // ledgerId is a freshly minted uuid (the service does not re-read the row).
    expect(typeof result.ledgerId).toBe('string');
    expect(result.ledgerId.length).toBeGreaterThan(0);
  });

  it('caps debit at available balance when amount exceeds balance', async () => {
    const env = makeEnv(makeDb([{ results: [{ total: 30 }] }]));
    const result = await applyCredits(env, 'org-1', 100, 'over-spend');
    expect(result.applied).toBe(30);
    expect(result.balance).toBe(0);
  });

  it('returns the prior ledger row when idempotency key matches', async () => {
    // Idempotency check SELECT returns the existing row → short-circuits.
    const env = makeEnv(
      makeDb([{ results: [{ id: 'ledger-existing', balance_after: 80, amount: -20 }] }]),
    );
    const result = await applyCredits(env, 'org-1', 20, 'retry', 'idem-key-123');
    expect(result.applied).toBe(20);
    expect(result.balance).toBe(80);
    expect(result.ledgerId).toBe('ledger-existing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processMonthlyRollover — resolveMonthlyAllowance SELECT, getBalance SELECT,
// then INSERT. Returns the credits GRANTED this cycle (0 at/above the cap).
// ─────────────────────────────────────────────────────────────────────────────
describe('processMonthlyRollover', () => {
  it('grants the full monthly allowance when wallet is empty', async () => {
    const env = makeEnv(
      makeDb([{ results: [{ monthly_credits: 100 }] }, { results: [{ total: 0 }] }]),
    );
    expect(await processMonthlyRollover(env, 'org-1')).toBe(100);
  });

  it('caps total balance at 3x the monthly allowance (grants only the headroom)', async () => {
    // allowance=100, cap=300, balance=250 → grant = min(350,300) - 250 = 50.
    const env = makeEnv(
      makeDb([{ results: [{ monthly_credits: 100 }] }, { results: [{ total: 250 }] }]),
    );
    expect(await processMonthlyRollover(env, 'org-1')).toBe(50);
  });

  it('grants nothing when balance is already at the cap', async () => {
    const env = makeEnv(
      makeDb([{ results: [{ monthly_credits: 100 }] }, { results: [{ total: 300 }] }]),
    );
    expect(await processMonthlyRollover(env, 'org-1')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getCreditHistory — one SELECT returning the ledger rows (dbQuery → results[])
// ─────────────────────────────────────────────────────────────────────────────
describe('getCreditHistory', () => {
  it('returns ledger rows newest-first', async () => {
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
    const env = makeEnv(makeDb([{ results: rows }]));
    const result = await getCreditHistory(env, 'org-1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('row-2');
    expect(result[1].id).toBe('row-1');
  });

  it('returns an empty array when there is no history', async () => {
    const env = makeEnv(makeDb([{ results: [] }]));
    expect(await getCreditHistory(env, 'org-1')).toEqual([]);
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
    expect(() =>
      ApplyCreditsBodySchema.parse({ amount: 10, description: 'test debit' }),
    ).not.toThrow();
  });

  it('accepts optional idempotency_key', () => {
    expect(() =>
      ApplyCreditsBodySchema.parse({ amount: 5, idempotency_key: 'key-abc' }),
    ).not.toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => ApplyCreditsBodySchema.parse({ amount: 10, extra: 'nope' })).toThrow();
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
  it('accepts a valid ledger row (null description + idempotency_key)', () => {
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
});

describe('ApplyCreditsResponseSchema', () => {
  it('accepts a valid apply response', () => {
    expect(() =>
      ApplyCreditsResponseSchema.parse({ applied: 50, balance: 150, ledger_id: 'ledger-1' }),
    ).not.toThrow();
  });
});

describe('CreditHistoryResponseSchema', () => {
  it('accepts a valid history response with empty rows', () => {
    expect(() =>
      CreditHistoryResponseSchema.parse({ org_id: 'org-1', rows: [], count: 0 }),
    ).not.toThrow();
  });
});
