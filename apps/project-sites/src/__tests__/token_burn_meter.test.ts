/**
 * Coverage for the `token_burn_meter` feature — previously UNTESTED at both the
 * service and route layers (its colocated libs/features test covers an unrelated
 * `build_budget` concern).
 *
 *   service (src/services/features.ts):
 *     - estimatePromptCost  (per-million pricing math, free models, unknown→fallback)
 *     - pickModel           (shape → model, userPref override + invalid-pref guard)
 *     - listModels          (catalog shape)
 *     - recordTokenEvent    (INSERT into token_events with rounded cents)
 *     - getMonthlyBurn      (per-model aggregation + projection shape)
 *
 *   route (src/routes/features.ts, flag-gated by token_burn_meter):
 *     - GET  /api/usage/burn    → getMonthlyBurn (flag-off 404, org_id default)
 *     - POST /api/usage/record  → recordTokenEvent (flag-off 404, body defaults)
 *
 * Only the flag resolver is mocked; the REAL feature service runs against a
 * captured D1 stub (faithful end-to-end through the Hono sub-app).
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  ...jest.requireActual('../modules/feature_flags/services.js'),
  isFlagOn: jest.fn(),
}));

import features from '../routes/features.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import {
  estimatePromptCost,
  pickModel,
  listModels,
  recordTokenEvent,
  getMonthlyBurn,
  type ModelId,
} from '../services/features.js';

const mockIsFlagOn = isFlagOn as jest.MockedFunction<typeof isFlagOn>;

type BurnRow = { model: string; input_tokens: number; output_tokens: number; usd_cents: number };

/** Capturing D1 stub: records prepared SQL + bound params; returns `rows` from .all(). */
function makeDb(rows: BurnRow[] = []) {
  const prepares: string[] = [];
  const binds: unknown[][] = [];
  const stmt = {
    bind: (...args: unknown[]) => {
      binds.push(args);
      return stmt;
    },
    run: async () => ({}),
    all: async () => ({ results: rows }),
    first: async () => null,
  };
  const env = { DB: { prepare: (sql: string) => (prepares.push(sql), stmt) } } as never;
  return { env, prepares, binds };
}

// ─── service: pure pricing + model selection ────────────────────────────────

describe('estimatePromptCost', () => {
  it('prices a paid model per million tokens', () => {
    // sonnet = $3/M in, $15/M out → 1M in + 1M out = $18
    const c = estimatePromptCost('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(c.usd).toBe(18);
    expect(c.free).toBe(false);
    expect(c.model).toBe('claude-sonnet-4-6');
  });

  it('reports free models at $0', () => {
    const c = estimatePromptCost('@cf/meta/llama-3.3-70b-instruct-fp8-fast', 5_000_000, 5_000_000);
    expect(c.usd).toBe(0);
    expect(c.free).toBe(true);
  });

  it('falls back to sonnet pricing for an unknown model', () => {
    const c = estimatePromptCost('totally-unknown' as ModelId, 1_000_000, 0);
    expect(c.usd).toBe(3); // sonnet input rate
  });
});

describe('pickModel', () => {
  it('maps shape → model', () => {
    expect(pickModel('complex')).toBe('claude-opus-4-7');
    expect(pickModel('creative')).toBe('claude-sonnet-4-6');
    expect(pickModel('free')).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    expect(pickModel('simple')).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  });

  it('honours a valid user preference over the shape', () => {
    expect(pickModel('free', 'gpt-5')).toBe('gpt-5');
  });

  it('ignores an invalid user preference', () => {
    expect(pickModel('complex', 'not-a-model' as ModelId)).toBe('claude-opus-4-7');
  });
});

describe('listModels', () => {
  it('returns the catalog with id + label per model', () => {
    const models = listModels();
    expect(models.map((m) => m.id)).toEqual(
      expect.arrayContaining(['claude-opus-4-7', 'claude-sonnet-4-6', 'gpt-5']),
    );
    expect(models.every((m) => typeof m.label === 'string')).toBe(true);
  });
});

// ─── service: DB-touching ───────────────────────────────────────────────────

describe('recordTokenEvent', () => {
  it('inserts a token_events row with rounded cents + returns the cost', async () => {
    const { env, prepares, binds } = makeDb();
    const out = await recordTokenEvent(env, {
      orgId: 'org-1',
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000_000, // $3.00 → 300 cents
      outputTokens: 0,
    });
    expect(out.usd).toBe(3);
    expect(out.cents).toBe(300);
    expect(typeof out.id).toBe('string');
    expect(prepares[0]).toMatch(/INSERT INTO token_events/);
    expect(binds[0]).toEqual(
      expect.arrayContaining(['org-1', 'claude-sonnet-4-6', 1_000_000, 0, 300]),
    );
  });
});

describe('getMonthlyBurn', () => {
  it('aggregates per-model usage + totals from token_events', async () => {
    const { env } = makeDb([
      { model: 'claude-sonnet-4-6', input_tokens: 1_000_000, output_tokens: 0, usd_cents: 300 },
      { model: 'gpt-5', input_tokens: 0, output_tokens: 100, usd_cents: 0 },
    ]);
    const burn = await getMonthlyBurn(env, 'org-1');
    expect(burn.used_usd).toBe(3);
    expect(burn.used_tokens).toBe(1_000_100);
    expect(burn.by_model['claude-sonnet-4-6']).toEqual({ tokens: 1_000_000, usd: 3 });
    expect(typeof burn.projected_monthly_usd).toBe('number');
    expect(burn.thresholds).toHaveLength(2);
  });

  it('returns zeroed totals when there is no usage', async () => {
    const { env } = makeDb([]);
    const burn = await getMonthlyBurn(env, 'org-empty');
    expect(burn.used_usd).toBe(0);
    expect(burn.used_tokens).toBe(0);
    expect(burn.by_model).toEqual({});
  });
});

// ─── route layer (flag-gated) ───────────────────────────────────────────────

describe('GET /api/usage/burn (token_burn_meter)', () => {
  beforeEach(() => mockIsFlagOn.mockResolvedValue(true));

  it('404s when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const { env } = makeDb();
    const res = await features.request('/api/usage/burn', {}, env);
    expect(res.status).toBe(404);
  });

  it('200s with the live aggregation for the org_id query', async () => {
    const { env } = makeDb([
      { model: 'claude-sonnet-4-6', input_tokens: 1_000_000, output_tokens: 0, usd_cents: 300 },
    ]);
    const res = await features.request('/api/usage/burn?org_id=org-9', {}, env);
    expect(res.status).toBe(200);
    expect((await res.json() as { used_usd: number }).used_usd).toBe(3);
  });
});

describe('POST /api/usage/record (token_burn_meter)', () => {
  beforeEach(() => mockIsFlagOn.mockResolvedValue(true));

  it('404s when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const { env } = makeDb();
    const res = await features.request(
      '/api/usage/record',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env,
    );
    expect(res.status).toBe(404);
  });

  it('200s + records the event with the rounded cost', async () => {
    const { env, prepares } = makeDb();
    const res = await features.request(
      '/api/usage/record',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ org_id: 'org-9', model: 'claude-sonnet-4-6', input_tokens: 1_000_000, output_tokens: 0 }),
      },
      env,
    );
    expect(res.status).toBe(200);
    expect((await res.json() as { cents: number }).cents).toBe(300);
    expect(prepares[0]).toMatch(/INSERT INTO token_events/);
  });
});
