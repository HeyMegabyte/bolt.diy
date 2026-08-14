import { dbQuery, dbExecute, dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';

// ---------------------------------------------------------------------------
// Mock D1 factory
// ---------------------------------------------------------------------------

interface MockD1 {
  db: D1Database;
  prepare: jest.Mock;
  bind: jest.Mock;
  all: jest.Mock;
  run: jest.Mock;
}

function createMockD1(overrides?: {
  allResult?: unknown;
  runResult?: unknown;
  allError?: Error;
  runError?: Error;
  bindError?: Error;
  prepareError?: Error;
}): MockD1 {
  const mockAll = overrides?.allError
    ? jest.fn().mockRejectedValue(overrides.allError)
    : jest.fn().mockResolvedValue(overrides?.allResult ?? { results: [] });

  const mockRun = overrides?.runError
    ? jest.fn().mockRejectedValue(overrides.runError)
    : jest.fn().mockResolvedValue(overrides?.runResult ?? { meta: { changes: 0 } });

  const mockBind = overrides?.bindError
    ? jest.fn().mockImplementation(() => {
        throw overrides.bindError;
      })
    : jest.fn().mockReturnValue({ all: mockAll, run: mockRun });

  const mockPrepare = overrides?.prepareError
    ? jest.fn().mockImplementation(() => {
        throw overrides.prepareError;
      })
    : jest.fn().mockReturnValue({ bind: mockBind });

  return {
    db: { prepare: mockPrepare } as unknown as D1Database,
    prepare: mockPrepare,
    bind: mockBind,
    all: mockAll,
    run: mockRun,
  };
}

// ---------------------------------------------------------------------------
// dbQuery
// ---------------------------------------------------------------------------

describe('dbQuery', () => {
  it('returns empty data array when no rows match', async () => {
    const { db } = createMockD1();

    const result = await dbQuery(db, 'SELECT * FROM sites');

    expect(result).toEqual({ data: [], error: null });
  });

  it('returns typed rows on success', async () => {
    const rows = [
      { id: '1', slug: 'alpha' },
      { id: '2', slug: 'beta' },
    ];
    const { db } = createMockD1({ allResult: { results: rows } });

    const result = await dbQuery<{ id: string; slug: string }>(
      db,
      'SELECT id, slug FROM sites WHERE org_id = ?',
      ['org-1'],
    );

    expect(result.data).toEqual(rows);
    expect(result.error).toBeNull();
  });

  it('passes SQL and params through prepare().bind()', async () => {
    const { db, prepare, bind } = createMockD1();

    await dbQuery(db, 'SELECT * FROM sites WHERE org_id = ? AND status = ?', ['org-1', 'active']);

    expect(prepare).toHaveBeenCalledWith('SELECT * FROM sites WHERE org_id = ? AND status = ?');
    expect(bind).toHaveBeenCalledWith('org-1', 'active');
  });

  it('defaults params to empty array (bind called with no arguments)', async () => {
    const { db, bind } = createMockD1();

    await dbQuery(db, 'SELECT 1');

    expect(bind).toHaveBeenCalledWith();
  });

  it('handles results being undefined (returns empty array)', async () => {
    const { db } = createMockD1({ allResult: { results: undefined } });

    const result = await dbQuery(db, 'SELECT 1');

    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('returns error message when D1 throws an Error', async () => {
    const { db } = createMockD1({ allError: new Error('D1_ERROR: table not found') });

    const result = await dbQuery(db, 'SELECT * FROM nonexistent');

    expect(result.data).toEqual([]);
    expect(result.error).toBe('D1_ERROR: table not found');
  });

  it('returns generic message when D1 throws a non-Error', async () => {
    const mockAll = jest.fn().mockRejectedValue('string-error');
    const mockBind = jest.fn().mockReturnValue({ all: mockAll, run: jest.fn() });
    const mockPrepare = jest.fn().mockReturnValue({ bind: mockBind });
    const db = { prepare: mockPrepare } as unknown as D1Database;

    const result = await dbQuery(db, 'SELECT 1');

    expect(result.data).toEqual([]);
    expect(result.error).toBe('Unknown D1 error');
  });

  it('catches errors thrown during prepare()', async () => {
    const { db } = createMockD1({ prepareError: new Error('SQL syntax error') });

    const result = await dbQuery(db, 'INVALID SQL %%%');

    expect(result.data).toEqual([]);
    expect(result.error).toBe('SQL syntax error');
  });

  it('catches errors thrown during bind()', async () => {
    const { db } = createMockD1({ bindError: new Error('parameter count mismatch') });

    const result = await dbQuery(db, 'SELECT * FROM sites WHERE id = ?', ['a', 'b']);

    expect(result.data).toEqual([]);
    expect(result.error).toBe('parameter count mismatch');
  });
});

// ---------------------------------------------------------------------------
// dbExecute
// ---------------------------------------------------------------------------

describe('dbExecute', () => {
  it('returns zero changes and no error on success with no rows affected', async () => {
    const { db } = createMockD1();

    const result = await dbExecute(db, 'DELETE FROM sites WHERE id = ?', ['nonexistent']);

    expect(result).toEqual({ error: null, changes: 0 });
  });

  it('returns the number of changed rows', async () => {
    const { db } = createMockD1({ runResult: { meta: { changes: 3 } } });

    const result = await dbExecute(db, 'UPDATE sites SET status = ? WHERE org_id = ?', [
      'archived',
      'org-1',
    ]);

    expect(result.changes).toBe(3);
    expect(result.error).toBeNull();
  });

  it('passes SQL and params through prepare().bind().run()', async () => {
    const { db, prepare, bind, run } = createMockD1();

    await dbExecute(db, 'DELETE FROM sessions WHERE token_hash = ?', ['abc123']);

    expect(prepare).toHaveBeenCalledWith('DELETE FROM sessions WHERE token_hash = ?');
    expect(bind).toHaveBeenCalledWith('abc123');
    expect(run).toHaveBeenCalled();
  });

  it('defaults params to empty array', async () => {
    const { db, bind } = createMockD1();

    await dbExecute(db, 'DELETE FROM expired_sessions');

    expect(bind).toHaveBeenCalledWith();
  });

  it('handles meta.changes being undefined (returns 0)', async () => {
    const { db } = createMockD1({ runResult: { meta: {} } });

    const result = await dbExecute(db, 'INSERT INTO log (msg) VALUES (?)', ['test']);

    expect(result.changes).toBe(0);
    expect(result.error).toBeNull();
  });

  it('handles meta being undefined (returns 0)', async () => {
    const { db } = createMockD1({ runResult: {} });

    const result = await dbExecute(db, 'INSERT INTO log (msg) VALUES (?)', ['test']);

    expect(result.changes).toBe(0);
    expect(result.error).toBeNull();
  });

  it('returns error message when D1 throws an Error', async () => {
    const { db } = createMockD1({ runError: new Error('UNIQUE constraint failed') });

    const result = await dbExecute(db, 'INSERT INTO sites (slug) VALUES (?)', ['duplicate-slug']);

    expect(result.error).toBe('UNIQUE constraint failed');
    expect(result.changes).toBe(0);
  });

  it('returns generic message when D1 throws a non-Error', async () => {
    const mockRun = jest.fn().mockRejectedValue(42);
    const mockBind = jest.fn().mockReturnValue({ all: jest.fn(), run: mockRun });
    const mockPrepare = jest.fn().mockReturnValue({ bind: mockBind });
    const db = { prepare: mockPrepare } as unknown as D1Database;

    const result = await dbExecute(db, 'INSERT INTO sites (slug) VALUES (?)', ['x']);

    expect(result.error).toBe('Unknown D1 error');
    expect(result.changes).toBe(0);
  });

  it('catches errors thrown during prepare()', async () => {
    const { db } = createMockD1({ prepareError: new Error('bad SQL') });

    const result = await dbExecute(db, 'NOT VALID SQL');

    expect(result.error).toBe('bad SQL');
    expect(result.changes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dbQueryOne
// ---------------------------------------------------------------------------

describe('dbQueryOne', () => {
  it('returns the first row when results exist', async () => {
    const rows = [
      { id: '1', slug: 'first' },
      { id: '2', slug: 'second' },
    ];
    const { db } = createMockD1({ allResult: { results: rows } });

    const result = await dbQueryOne<{ id: string; slug: string }>(
      db,
      'SELECT * FROM sites WHERE org_id = ?',
      ['org-1'],
    );

    expect(result).toEqual({ id: '1', slug: 'first' });
  });

  it('returns null when no rows match', async () => {
    const { db } = createMockD1({ allResult: { results: [] } });

    const result = await dbQueryOne(db, 'SELECT * FROM sites WHERE id = ?', ['nonexistent']);

    expect(result).toBeNull();
  });

  it('returns null when results is undefined', async () => {
    const { db } = createMockD1({ allResult: { results: undefined } });

    const result = await dbQueryOne(db, 'SELECT 1');

    expect(result).toBeNull();
  });

  it('returns null when D1 throws (error path in dbQuery)', async () => {
    const { db } = createMockD1({ allError: new Error('table not found') });

    const result = await dbQueryOne(db, 'SELECT * FROM nonexistent');

    expect(result).toBeNull();
  });

  it('passes params through to dbQuery', async () => {
    const { db, prepare, bind } = createMockD1();

    await dbQueryOne(db, 'SELECT * FROM sessions WHERE token_hash = ?', ['hash-abc']);

    expect(prepare).toHaveBeenCalledWith('SELECT * FROM sessions WHERE token_hash = ?');
    expect(bind).toHaveBeenCalledWith('hash-abc');
  });

  it('defaults params to empty array', async () => {
    const { db, bind } = createMockD1();

    await dbQueryOne(db, 'SELECT COUNT(*) as cnt FROM sites');

    expect(bind).toHaveBeenCalledWith();
  });
});

// ---------------------------------------------------------------------------
// dbInsert
// ---------------------------------------------------------------------------

describe('dbInsert', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('generates correct INSERT SQL from row keys', async () => {
    const { db, prepare } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbInsert(db, 'sites', { id: 'site-1', slug: 'my-site', business_name: 'Acme' });

    const sql = prepare.mock.calls[0][0] as string;
    expect(sql).toContain('INSERT INTO sites');
    expect(sql).toContain('created_at');
    expect(sql).toContain('updated_at');
    expect(sql).toContain('id');
    expect(sql).toContain('slug');
    expect(sql).toContain('business_name');
  });

  it('auto-adds created_at and updated_at timestamps', async () => {
    const { db, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbInsert(db, 'sites', { id: 'site-1' });

    const boundValues = bind.mock.calls[0] as unknown[];
    expect(boundValues).toContain('2025-06-15T12:00:00.000Z');
    // Both created_at and updated_at should be set
    const timestampCount = boundValues.filter((v) => v === '2025-06-15T12:00:00.000Z').length;
    expect(timestampCount).toBe(2);
  });

  it('does not override caller-supplied created_at', async () => {
    const { db, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbInsert(db, 'sites', { id: 'site-1', created_at: '2024-01-01T00:00:00.000Z' });

    const boundValues = bind.mock.calls[0] as unknown[];
    // The caller's created_at should win because row is spread after defaults
    expect(boundValues).toContain('2024-01-01T00:00:00.000Z');
  });

  it('does not override caller-supplied updated_at', async () => {
    const { db, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbInsert(db, 'sites', { id: 'site-1', updated_at: '2024-01-01T00:00:00.000Z' });

    const boundValues = bind.mock.calls[0] as unknown[];
    expect(boundValues).toContain('2024-01-01T00:00:00.000Z');
  });

  it('generates correct number of ? placeholders', async () => {
    const { db, prepare } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbInsert(db, 'sites', { id: 'site-1', slug: 'my-site', status: 'draft' });

    const sql = prepare.mock.calls[0][0] as string;
    // 3 user fields + 2 timestamp fields = 5 placeholders
    const placeholders = sql.match(/\?/g);
    expect(placeholders).toHaveLength(5);
  });

  it('returns null error on success', async () => {
    const { db } = createMockD1({ runResult: { meta: { changes: 1 } } });

    const result = await dbInsert(db, 'sites', { id: 'site-1', slug: 'my-site' });

    expect(result.error).toBeNull();
  });

  it('returns error on D1 failure', async () => {
    const { db } = createMockD1({
      runError: new Error('UNIQUE constraint failed: sites.slug'),
    });

    const result = await dbInsert(db, 'sites', { id: 'site-2', slug: 'duplicate' });

    expect(result.error).toBe('UNIQUE constraint failed: sites.slug');
  });

  // Regression guard for the missing-timestamp RETRY (db.ts dbInsert). A table
  // that lacks created_at/updated_at makes the default insert fail with SQLite's
  // "table T has no column named updated_at". dbInsert MUST detect that, cache the
  // table, and retry with the RAW row so the insert PERSISTS. Without this retry,
  // callers that ignore the returned {error} (super-admin broadcasts/announcements,
  // mcp_calls, and historically form_submissions) return a lying-success and
  // silently DROP the row. This locks the dual-wording regex ("has no column named"
  // AND "no such column") so a future "simplification" can't reintroduce the drop.
  // (Verified 2026-08-07: this retry is exactly why an unchecked dbInsert on an
  // updated_at-less table is NOT a lying-success — the row persists on the retry.)
  it('retries without timestamps when the table lacks an updated_at column (persists, not a lying-success)', async () => {
    const { db, run, prepare } = createMockD1();
    // First attempt (with created_at/updated_at) fails on the missing column;
    // the retry (raw row) succeeds.
    run
      .mockRejectedValueOnce(new Error('table gadgets_no_ts has no column named updated_at'))
      .mockResolvedValue({ meta: { changes: 1 } });

    const result = await dbInsert(db, 'gadgets_no_ts', { id: 'g1', label: 'x' });

    // Retry fired → row persisted → error cleared (NOT a silent drop).
    expect(result.error).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
    // First SQL carried the timestamp columns; the retry SQL stripped them.
    const firstSql = prepare.mock.calls[0][0] as string;
    const retrySql = prepare.mock.calls[1][0] as string;
    expect(firstSql).toContain('updated_at');
    expect(retrySql).not.toContain('updated_at');
    expect(retrySql).not.toContain('created_at');
  });

  it('binds values in the same order as keys', async () => {
    const { db, prepare, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbInsert(db, 'sites', { id: 'x', slug: 'y', status: 'z' });

    const sql = prepare.mock.calls[0][0] as string;
    const colsPart = sql.match(/\(([^)]+)\) VALUES/)?.[1] ?? '';
    const cols = colsPart.split(',').map((c) => c.trim());

    const boundValues = bind.mock.calls[0] as unknown[];
    // Each column's position should match its value's position in bind args
    const idIndex = cols.indexOf('id');
    expect(boundValues[idIndex]).toBe('x');

    const slugIndex = cols.indexOf('slug');
    expect(boundValues[slugIndex]).toBe('y');

    const statusIndex = cols.indexOf('status');
    expect(boundValues[statusIndex]).toBe('z');
  });

  it('handles an empty row object (only timestamps)', async () => {
    const { db, prepare, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbInsert(db, 'sites', {});

    const sql = prepare.mock.calls[0][0] as string;
    expect(sql).toContain('created_at');
    expect(sql).toContain('updated_at');
    const placeholders = sql.match(/\?/g);
    expect(placeholders).toHaveLength(2);
    expect(bind).toHaveBeenCalledWith('2025-06-15T12:00:00.000Z', '2025-06-15T12:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// dbUpdate
// ---------------------------------------------------------------------------

describe('dbUpdate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-06-15T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('generates correct UPDATE SQL', async () => {
    const { db, prepare } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbUpdate(db, 'sites', { status: 'published' }, 'id = ?', ['site-1']);

    const sql = prepare.mock.calls[0][0] as string;
    expect(sql).toBe('UPDATE sites SET status = ?, updated_at = ? WHERE id = ?');
  });

  it('auto-adds updated_at timestamp', async () => {
    const { db, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbUpdate(db, 'sites', { status: 'published' }, 'id = ?', ['site-1']);

    const boundValues = bind.mock.calls[0] as unknown[];
    expect(boundValues).toContain('2025-06-15T12:00:00.000Z');
  });

  it('places SET values before WHERE params in bind order', async () => {
    const { db, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbUpdate(
      db,
      'sites',
      { status: 'published', current_build_version: 'v2' },
      'id = ? AND org_id = ?',
      ['site-1', 'org-1'],
    );

    const boundValues = bind.mock.calls[0] as unknown[];
    // SET values: status, current_build_version, updated_at, then WHERE: site-1, org-1
    expect(boundValues[0]).toBe('published');
    expect(boundValues[1]).toBe('v2');
    expect(boundValues[2]).toBe('2025-06-15T12:00:00.000Z');
    expect(boundValues[3]).toBe('site-1');
    expect(boundValues[4]).toBe('org-1');
  });

  it('returns changes count on success', async () => {
    const { db } = createMockD1({ runResult: { meta: { changes: 5 } } });

    const result = await dbUpdate(db, 'sites', { status: 'archived' }, 'org_id = ?', ['org-1']);

    expect(result.changes).toBe(5);
    expect(result.error).toBeNull();
  });

  it('returns zero changes when no rows match', async () => {
    const { db } = createMockD1({ runResult: { meta: { changes: 0 } } });

    const result = await dbUpdate(db, 'sites', { status: 'published' }, 'id = ?', ['nonexistent']);

    expect(result.changes).toBe(0);
    expect(result.error).toBeNull();
  });

  it('returns error on D1 failure', async () => {
    const { db } = createMockD1({ runError: new Error('no such column: bad_col') });

    const result = await dbUpdate(db, 'sites', { bad_col: 'value' }, 'id = ?', ['site-1']);

    expect(result.error).toBe('no such column: bad_col');
    expect(result.changes).toBe(0);
  });

  it('defaults whereParams to empty array', async () => {
    const { db, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbUpdate(db, 'sites', { status: 'archived' }, '1 = 1');

    const boundValues = bind.mock.calls[0] as unknown[];
    // Only SET values: status, updated_at (no WHERE params)
    expect(boundValues).toHaveLength(2);
    expect(boundValues[0]).toBe('archived');
    expect(boundValues[1]).toBe('2025-06-15T12:00:00.000Z');
  });

  it('overrides caller-supplied updated_at with current timestamp', async () => {
    const { db, bind } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbUpdate(
      db,
      'sites',
      { status: 'published', updated_at: '2020-01-01T00:00:00.000Z' },
      'id = ?',
      ['site-1'],
    );

    const boundValues = bind.mock.calls[0] as unknown[];
    // The spread order in dbUpdate is { ...updates, updated_at: now } so current time wins
    const updatedAtValue = boundValues.find(
      (v) => typeof v === 'string' && (v as string).startsWith('2025-'),
    );
    expect(updatedAtValue).toBe('2025-06-15T12:00:00.000Z');
  });

  it('handles multiple SET columns', async () => {
    const { db, prepare } = createMockD1({ runResult: { meta: { changes: 1 } } });

    await dbUpdate(
      db,
      'sites',
      { status: 'published', business_name: 'New Name', slug: 'new-slug' },
      'id = ?',
      ['site-1'],
    );

    const sql = prepare.mock.calls[0][0] as string;
    expect(sql).toContain('status = ?');
    expect(sql).toContain('business_name = ?');
    expect(sql).toContain('slug = ?');
    expect(sql).toContain('updated_at = ?');
    expect(sql).toContain('WHERE id = ?');
  });

  // Regression guard for the missing-updated_at RETRY (db.ts dbUpdate) — the sibling
  // of dbInsert's retry above. `site_benchmarks` has created_at but NO updated_at, so a
  // plain `UPDATE ... SET x = ?, updated_at = ?` fails with "no such column: updated_at".
  // recordRetrospectivePath ignores the returned {error} → without this retry the update
  // is a lying no-op and retrospective_path is silently NEVER persisted (data loss).
  // dbUpdate MUST detect the missing column, cache the table, and retry with the raw
  // updates so the write PERSISTS. Locks the dual-wording regex against a future
  // "simplification". Uses a unique table name so the per-isolate cache stays test-order
  // independent (no cross-test pollution).
  it('retries without updated_at when the table lacks that column (persists, not a lying no-op)', async () => {
    const { db, run, prepare } = createMockD1();
    // First attempt (with updated_at) fails on the missing column; the retry (raw
    // updates) succeeds.
    run
      .mockRejectedValueOnce(new Error('no such column: updated_at'))
      .mockResolvedValue({ meta: { changes: 1 } });

    const result = await dbUpdate(
      db,
      'benchmarks_no_ts',
      { retrospective_path: '/r/x.md' },
      'id = ?',
      ['b1'],
    );

    // Retry fired → row updated → error cleared + changes surfaced (NOT a silent no-op).
    expect(result.error).toBeNull();
    expect(result.changes).toBe(1);
    expect(run).toHaveBeenCalledTimes(2);
    // First SQL carried updated_at; the retry SQL stripped it but kept the real column.
    const firstSql = prepare.mock.calls[0][0] as string;
    const retrySql = prepare.mock.calls[1][0] as string;
    expect(firstSql).toContain('updated_at');
    expect(retrySql).not.toContain('updated_at');
    expect(retrySql).toContain('retrospective_path = ?');
  });
});
