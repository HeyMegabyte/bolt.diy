/**
 * Route coverage for the Worker Tail Log Explorer (convergence r38).
 *
 * Exercises both handlers end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries: the feature-flag gate
 * ({@link isFlagOn}), the query DSL helpers ({@link parseLogQuery} /
 * {@link buildWhereClause}), and the D1 `DB.prepare(...).bind(...).all()` chain.
 *
 * Covers: auth 401, flag-gate 404, Zod 400 (search body + cost-by-route query),
 * happy-path search with keyset pagination (hasMore + next_cursor) and meta_json
 * parse-safety, org scoping into the flag gate, cost-by-route aggregation +
 * cost_share_pct math, and the empty-result / DB-error paths.
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(),
}));
jest.mock('../services/log_query.js', () => ({
  parseLogQuery: jest.fn(),
  buildWhereClause: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { logs } from '../routes/logs.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { parseLogQuery, buildWhereClause } from '../services/log_query.js';

const mockIsFlagOn = isFlagOn as unknown as jest.Mock;
const mockParseLogQuery = parseLogQuery as unknown as jest.Mock;
const mockBuildWhereClause = buildWhereClause as unknown as jest.Mock;

// ─── D1 boundary mock ──────────────────────────────────────────────────────────

type LogRow = {
  id: string;
  ts: string;
  level: string;
  request_id: string;
  route: string;
  method: string;
  status: number | null;
  duration_ms: number | null;
  cost_estimate: number;
  message: string;
  meta_json: string;
};

/**
 * Mock D1 covering BOTH access shapes the route uses:
 *   - search: `prepare(sql).bind(...).all()` (keyset-paginated)
 *   - cost-by-route: `prepare(sql).all()` (no bind)
 * Resolves to the supplied rows (or throws). Records the SQL and the final bind
 * args so tests can assert pagination behavior.
 */
function makeDb(rows: unknown[] = [], opts: { throws?: boolean } = {}) {
  const all = jest.fn(async () => {
    if (opts.throws) throw new Error('D1_ERROR: query failed');
    return { results: rows };
  });
  const bind = jest.fn(() => ({ all }));
  let capturedSql = '';
  const prepare = jest.fn((sql: string) => {
    capturedSql = sql;
    return { bind, all }; // bind() for search; all() directly for cost-by-route
  });
  return {
    db: { prepare } as unknown as D1Database,
    prepare,
    bind,
    all,
    get sql() {
      return capturedSql;
    },
  };
}

function makeEnv(db: D1Database): Env {
  return { ENVIRONMENT: 'test', DB: db } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/** Build the app, seeding the auth context vars the handler reads. No vars = unauthenticated. */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', logs);
  return app;
}

function searchReq(app: ReturnType<typeof makeApp>, body: unknown, env: Env) {
  return app.request(
    '/api/logs/search',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

function costReq(app: ReturnType<typeof makeApp>, qs: string, env: Env) {
  return app.request(`/api/logs/cost-by-route${qs}`, { method: 'GET' }, env);
}

const AUTH: Partial<Variables> = { orgId: 'org-1', userId: 'user-1', requestId: 'req-1' };

function makeLogRow(over: Partial<LogRow> = {}): LogRow {
  return {
    id: 'log-1',
    ts: '2026-06-03T12:00:00.000Z',
    level: 'error',
    request_id: 'r-1',
    route: '/api/sites',
    method: 'GET',
    status: 500,
    duration_ms: 1200,
    cost_estimate: 0.002,
    message: 'boom',
    meta_json: '{"k":"v"}',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default the DSL helpers so search tests that don't care can run.
  mockParseLogQuery.mockReturnValue({ text: '', filters: [] });
  mockBuildWhereClause.mockReturnValue({ where: '', bindings: [] });
});

// ════════════════════════════════════════════════════════════════════════════
// POST /api/logs/search
// ════════════════════════════════════════════════════════════════════════════

describe('POST /api/logs/search', () => {
  // ── Auth ────────────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated and never checks the flag', async () => {
    const { db } = makeDb();
    const res = await searchReq(makeApp(), { query: 'level:error' }, makeEnv(db));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockIsFlagOn).not.toHaveBeenCalled();
  });

  // ── Flag gate ─────────────────────────────────────────────────────────────
  it('returns 404 feature_disabled when the flag is off and never queries D1', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const m = makeDb();
    const res = await searchReq(makeApp(AUTH), { query: '' }, makeEnv(m.db));
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('feature_disabled');
    expect(m.prepare).not.toHaveBeenCalled();
    // Org scoping: flag gate is checked with the caller's org.
    expect(mockIsFlagOn).toHaveBeenCalledWith(expect.anything(), 'log_explorer', { orgId: 'org-1' });
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  it('returns 400 when limit exceeds the Zod max (500)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await searchReq(makeApp(AUTH), { limit: 9999 }, makeEnv(makeDb().db));
    expect(res.status).toBe(400);
  });

  it('returns 400 when range is not one of the allowed enum values', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await searchReq(makeApp(AUTH), { range: '90d' }, makeEnv(makeDb().db));
    expect(res.status).toBe(400);
  });

  it('rejects a non-JSON body (zValidator(json) throws → 500) before touching D1', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const m = makeDb();
    const res = await makeApp(AUTH).request(
      '/api/logs/search',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' },
      makeEnv(m.db),
    );
    // Hono's json validator throws on an unparseable body; the shared errorHandler
    // maps it to a 500. The handler never reaches the D1 query.
    expect(res.status).toBe(500);
    expect(m.prepare).not.toHaveBeenCalled();
  });

  // ── Happy path ─────────────────────────────────────────────────────────────
  it('returns 200 with parsed rows and applies Zod defaults when body is empty', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const m = makeDb([makeLogRow()]);
    const res = await searchReq(makeApp(AUTH), {}, makeEnv(m.db));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { items: Array<Record<string, unknown>>; next_cursor: string | null; total_returned: number };
    };
    expect(json.data.total_returned).toBe(1);
    expect(json.data.next_cursor).toBeNull(); // only 1 row, limit default 100 → no more
    expect(json.data.items[0]?.['meta']).toEqual({ k: 'v' }); // meta_json parsed
    // Default limit 100 → bind requests limit+1 = 101 as the final arg.
    const lastArgs = m.bind.mock.calls[m.bind.mock.calls.length - 1] as unknown[];
    expect(lastArgs[lastArgs.length - 1]).toBe(101);
  });

  it('falls back to {} when a row has unparseable meta_json (never throws)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const m = makeDb([makeLogRow({ meta_json: 'not-json{' })]);
    const res = await searchReq(makeApp(AUTH), {}, makeEnv(m.db));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: Array<Record<string, unknown>> } };
    expect(json.data.items[0]?.['meta']).toEqual({});
  });

  it('treats a missing results array as an empty page', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const all = jest.fn(async () => ({}) as { results?: unknown[] });
    const bind = jest.fn(() => ({ all }));
    const db = { prepare: jest.fn(() => ({ bind })) } as unknown as D1Database;
    const res = await searchReq(makeApp(AUTH), {}, makeEnv(db));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { total_returned: number; next_cursor: string | null } };
    expect(json.data.total_returned).toBe(0);
    expect(json.data.next_cursor).toBeNull();
  });

  // ── Pagination (keyset) ────────────────────────────────────────────────────
  it('sets next_cursor and trims to limit when D1 returns the extra row (hasMore)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    // limit:2 → handler fetches 3; returning 3 rows means hasMore.
    const rows = [
      makeLogRow({ id: 'a', ts: '2026-06-03T03:00:00.000Z' }),
      makeLogRow({ id: 'b', ts: '2026-06-03T02:00:00.000Z' }),
      makeLogRow({ id: 'c', ts: '2026-06-03T01:00:00.000Z' }),
    ];
    const m = makeDb(rows);
    const res = await searchReq(makeApp(AUTH), { limit: 2 }, makeEnv(m.db));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { items: unknown[]; next_cursor: string | null } };
    expect(json.data.items).toHaveLength(2); // trimmed to limit
    expect(json.data.next_cursor).toBe('2026-06-03T02:00:00.000Z'); // ts of the last kept item
  });

  it('appends the cursor to the bindings when a cursor is supplied', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockBuildWhereClause.mockReturnValue({ where: 'WHERE level = ?', bindings: ['error'] });
    const m = makeDb([makeLogRow()]);
    const res = await searchReq(
      makeApp(AUTH),
      { query: 'level:error', cursor: '2026-06-03T00:00:00.000Z', limit: 50 },
      makeEnv(m.db),
    );
    expect(res.status).toBe(200);
    // bindings: ['error', cursor, limit+1]
    const lastArgs = m.bind.mock.calls[m.bind.mock.calls.length - 1] as unknown[];
    expect(lastArgs).toContain('error');
    expect(lastArgs).toContain('2026-06-03T00:00:00.000Z');
    expect(lastArgs[lastArgs.length - 1]).toBe(51);
    // DSL helpers received the user query.
    expect(mockParseLogQuery).toHaveBeenCalledWith('level:error');
  });

  // ── Error path ─────────────────────────────────────────────────────────────
  it('returns 500 when the D1 query throws', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const m = makeDb([], { throws: true });
    const res = await searchReq(makeApp(AUTH), {}, makeEnv(m.db));
    expect(res.status).toBe(500);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// GET /api/logs/cost-by-route
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/logs/cost-by-route', () => {
  // ── Auth ────────────────────────────────────────────────────────────────
  it('returns 401 when unauthenticated and never checks the flag', async () => {
    const res = await costReq(makeApp(), '', makeEnv(makeDb().db));
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockIsFlagOn).not.toHaveBeenCalled();
  });

  // ── Flag gate ─────────────────────────────────────────────────────────────
  it('returns 404 feature_disabled when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const m = makeDb();
    const res = await costReq(makeApp(AUTH), '', makeEnv(m.db));
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('feature_disabled');
    expect(m.prepare).not.toHaveBeenCalled();
    expect(mockIsFlagOn).toHaveBeenCalledWith(expect.anything(), 'log_explorer', { orgId: 'org-1' });
  });

  // ── Validation ─────────────────────────────────────────────────────────────
  it('returns 400 when the range query param is invalid', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await costReq(makeApp(AUTH), '?range=forever', makeEnv(makeDb().db));
    expect(res.status).toBe(400);
  });

  // ── Happy path + cost share math ────────────────────────────────────────────
  it('returns 200 with grand_total_cost and per-route cost_share_pct', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const rows = [
      { route: '/api/sites', request_count: 10, total_cost: 0.75, avg_cost: 0.075, avg_duration_ms: 120, error_count: 1, max_duration_ms: 900 },
      { route: '/api/logs', request_count: 5, total_cost: 0.25, avg_cost: 0.05, avg_duration_ms: 80, error_count: 0, max_duration_ms: 400 },
    ];
    const m = makeDb(rows);
    const res = await costReq(makeApp(AUTH), '?range=7d', makeEnv(m.db));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { range: string; grand_total_cost: number; rows: Array<{ route: string; cost_share_pct: number }> };
    };
    expect(json.data.range).toBe('7d');
    expect(json.data.grand_total_cost).toBeCloseTo(1.0, 6);
    expect(json.data.rows[0]?.cost_share_pct).toBeCloseTo(75, 6);
    expect(json.data.rows[1]?.cost_share_pct).toBeCloseTo(25, 6);
  });

  it('defaults range to 24h and yields 0 grand total when there are no rows', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const m = makeDb([]);
    const res = await costReq(makeApp(AUTH), '', makeEnv(m.db));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { range: string; grand_total_cost: number; rows: unknown[] } };
    expect(json.data.range).toBe('24h');
    expect(json.data.grand_total_cost).toBe(0);
    expect(json.data.rows).toHaveLength(0);
  });

  it('guards against divide-by-zero (cost_share_pct = 0) when grand total is 0', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const rows = [
      { route: '/api/free', request_count: 3, total_cost: 0, avg_cost: 0, avg_duration_ms: 10, error_count: 0, max_duration_ms: 20 },
    ];
    const m = makeDb(rows);
    const res = await costReq(makeApp(AUTH), '?range=1h', makeEnv(m.db));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { rows: Array<{ cost_share_pct: number }> } };
    expect(json.data.rows[0]?.cost_share_pct).toBe(0);
  });

  // ── Error path ─────────────────────────────────────────────────────────────
  it('returns 500 when the D1 aggregation throws', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const m = makeDb([], { throws: true });
    const res = await costReq(makeApp(AUTH), '', makeEnv(m.db));
    expect(res.status).toBe(500);
  });
});
