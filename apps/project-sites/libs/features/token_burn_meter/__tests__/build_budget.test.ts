/**
 * Unit tests for the Token-Burn Meter budget service (idea #13).
 *
 * Covers: under-budget allowed, over-budget blocked (killswitch), unlimited-org
 * bypass (owner email + plan), and recordSpend accumulation. D1 is mocked
 * in-memory with a tiny query interpreter that understands the three SQL shapes
 * `build_budget.ts` issues (owner lookup, month-spend SUM, usage_events INSERT).
 */

import {
  checkBudget,
  recordSpend,
  PLAN_BUDGET_USD,
  AI_SPEND_METRIC,
  SpendRecordSchema,
} from '../../../../src/services/build_budget.js';

interface UsageRow {
  org_id: string;
  metric: string;
  value: number;
  ts: string;
}

/**
 * Minimal D1 double. Handles:
 *  - SELECT u.email … (owner-email whitelist lookup)
 *  - SELECT COALESCE(SUM(value),0) … usage_events (month spend)
 *  - INSERT INTO usage_events … (recordSpend)
 */
function makeDb(opts: { ownerEmail?: string; rows?: UsageRow[] } = {}) {
  const rows: UsageRow[] = opts.rows ? [...opts.rows] : [];
  const ownerEmail = opts.ownerEmail ?? 'someone@example.com';

  function prepare(sql: string) {
    let bound: unknown[] = [];
    const api = {
      bind: (...params: unknown[]) => {
        bound = params;
        return api;
      },
      first: async <T>(): Promise<T | null> => {
        if (sql.includes('FROM users')) {
          return { email: ownerEmail } as unknown as T;
        }
        if (sql.includes('SUM(value)')) {
          const [orgId, metric] = bound as [string, string];
          const total = rows
            .filter((r) => r.org_id === orgId && r.metric === metric)
            .reduce((acc, r) => acc + r.value, 0);
          return { total } as unknown as T;
        }
        return null;
      },
      all: async <T>(): Promise<{ results: T[] }> => {
        const r = await api.first<T>();
        return { results: r ? [r] : [] };
      },
      run: async (): Promise<{ meta: { changes: number } }> => {
        // INSERT INTO usage_events (created_at, updated_at, id, org_id, site_id, metric, value, ts, billed, stripe_subscription_item_id)
        // Column order is deterministic from dbInsert; pull org_id / metric / value by index.
        const cols = sql
          .slice(sql.indexOf('(') + 1, sql.indexOf(')'))
          .split(',')
          .map((s) => s.trim());
        const get = (name: string) => bound[cols.indexOf(name)];
        rows.push({
          org_id: String(get('org_id')),
          metric: String(get('metric')),
          value: Number(get('value')),
          ts: String(get('ts')),
        });
        return { meta: { changes: 1 } };
      },
    };
    return api;
  }

  return { db: { prepare } as unknown as D1Database, rows };
}

const ORG = 'org-123';

describe('build_budget/checkBudget', () => {
  test('under-budget → allowed=true with correct headroom', async () => {
    // free cap = $5; $1 spent (1_000_000 micro-USD).
    const { db } = makeDb({ rows: [usageRow(ORG, 1_000_000)] });
    const meter = await checkBudget(db, ORG, 'free');

    expect(meter.allowed).toBe(true);
    expect(meter.spentUsd).toBeCloseTo(1);
    expect(meter.capUsd).toBe(PLAN_BUDGET_USD.free);
    expect(meter.remainingUsd).toBeCloseTo(4);
    expect(meter.pct).toBeCloseTo(20);
  });

  test('over-budget → allowed=false (killswitch)', async () => {
    // free cap = $5; $6 spent → blocked.
    const { db } = makeDb({ rows: [usageRow(ORG, 6_000_000)] });
    const meter = await checkBudget(db, ORG, 'free');

    expect(meter.allowed).toBe(false);
    expect(meter.spentUsd).toBeCloseTo(6);
    expect(meter.remainingUsd).toBe(0);
    expect(meter.pct).toBe(100);
  });

  test('exactly at the cap → allowed=false (>= is the killswitch)', async () => {
    const { db } = makeDb({ rows: [usageRow(ORG, 5_000_000)] });
    const meter = await checkBudget(db, ORG, 'free');
    expect(meter.allowed).toBe(false);
  });

  test('paid plan raises the cap to $100', async () => {
    const { db } = makeDb({ rows: [usageRow(ORG, 50_000_000)] }); // $50
    const meter = await checkBudget(db, ORG, 'paid');
    expect(meter.allowed).toBe(true);
    expect(meter.capUsd).toBe(PLAN_BUDGET_USD.paid);
    expect(meter.remainingUsd).toBeCloseTo(50);
  });

  test('unlimited plan bypasses the cap → Infinity, always allowed', async () => {
    const { db } = makeDb({ rows: [usageRow(ORG, 999_000_000)] });
    const meter = await checkBudget(db, ORG, 'unlimited');
    expect(meter.allowed).toBe(true);
    expect(meter.capUsd).toBe(Infinity);
    expect(meter.remainingUsd).toBe(Infinity);
    expect(meter.pct).toBe(0);
  });

  test('brian@megabyte.space owner bypasses the cap regardless of plan', async () => {
    const { db } = makeDb({
      ownerEmail: 'brian@megabyte.space',
      rows: [usageRow('org-unl', 999_000_000)],
    });
    const meter = await checkBudget(db, 'org-unl', 'free');
    expect(meter.allowed).toBe(true);
    expect(meter.capUsd).toBe(Infinity);
  });

  test('zero spend → allowed with full headroom', async () => {
    const { db } = makeDb({ rows: [] });
    const meter = await checkBudget(db, ORG, 'free');
    expect(meter.allowed).toBe(true);
    expect(meter.spentUsd).toBe(0);
    expect(meter.remainingUsd).toBe(PLAN_BUDGET_USD.free);
    expect(meter.pct).toBe(0);
  });
});

describe('build_budget/recordSpend', () => {
  test('accumulates spend as integer micro-USD into usage_events', async () => {
    const { db, rows } = makeDb({ rows: [] });
    await recordSpend({ DB: db }, ORG, {
      tokensIn: 1200,
      tokensOut: 800,
      model: 'claude-opus',
      usd: 0.42,
    });

    const spendRows = rows.filter((r) => r.metric === AI_SPEND_METRIC);
    expect(spendRows).toHaveLength(1);
    expect(spendRows[0]!.value).toBe(420_000); // 0.42 USD → micro-USD
    expect(spendRows[0]!.org_id).toBe(ORG);
  });

  test('multiple records sum into the meter', async () => {
    const { db } = makeDb({ rows: [] });
    await recordSpend({ DB: db }, ORG, { model: 'm', usd: 2, tokensIn: 0, tokensOut: 0 });
    await recordSpend({ DB: db }, ORG, { model: 'm', usd: 1.5, tokensIn: 0, tokensOut: 0 });

    const meter = await checkBudget(db, ORG, 'free');
    expect(meter.spentUsd).toBeCloseTo(3.5);
    expect(meter.allowed).toBe(true);
  });

  test('accumulation crosses the cap and flips the killswitch', async () => {
    const { db } = makeDb({ rows: [] });
    await recordSpend({ DB: db }, ORG, { model: 'm', usd: 4, tokensIn: 0, tokensOut: 0 });
    expect((await checkBudget(db, ORG, 'free')).allowed).toBe(true);

    await recordSpend({ DB: db }, ORG, { model: 'm', usd: 2, tokensIn: 0, tokensOut: 0 });
    expect((await checkBudget(db, ORG, 'free')).allowed).toBe(false);
  });

  test('zero-cost spend is a no-op (no row written)', async () => {
    const { db, rows } = makeDb({ rows: [] });
    await recordSpend({ DB: db }, ORG, { model: 'm', usd: 0, tokensIn: 10, tokensOut: 5 });
    expect(rows.filter((r) => r.metric === AI_SPEND_METRIC)).toHaveLength(0);
  });

  test('never throws on an invalid record (best-effort metering)', async () => {
    const { db, rows } = makeDb({ rows: [] });
    await expect(
      // @ts-expect-error — intentionally invalid: negative usd.
      recordSpend({ DB: db }, ORG, { model: 'm', usd: -5 }),
    ).resolves.toBeUndefined();
    expect(rows.filter((r) => r.metric === AI_SPEND_METRIC)).toHaveLength(0);
  });
});

describe('build_budget/SpendRecordSchema', () => {
  test('defaults token counts to 0 and rejects unknown keys', () => {
    const parsed = SpendRecordSchema.parse({ model: 'm', usd: 1 });
    expect(parsed.tokensIn).toBe(0);
    expect(parsed.tokensOut).toBe(0);
    expect(() =>
      // @ts-expect-error — unknown key rejected by .strict().
      SpendRecordSchema.parse({ model: 'm', usd: 1, bogus: true }),
    ).toThrow();
  });
});

/** Build a usage_events row carrying AI spend in micro-USD. */
function usageRow(orgId: string, microUsd: number): UsageRow {
  return { org_id: orgId, metric: AI_SPEND_METRIC, value: microUsd, ts: new Date().toISOString() };
}
