/**
 * @module __tests__/log_query
 * @description
 * Unit tests for the Worker tail-log search query DSL parser + WHERE-clause
 * builder (`src/services/log_query.ts`). Covers parse-side token handling
 * (level/route/duration/status/free-text/quoted/AND-OR), the D1 SQL clause
 * shape + bindings, time-range mapping, glob→LIKE translation, FTS sub-select,
 * empty/malformed input, and pagination param surfaces.
 *
 * Pure functions — no D1/KV/fetch to mock.
 */

import {
  parseLogQuery,
  buildWhereClause,
  type ParsedQuery,
  type LogSearchParams,
} from '../services/log_query.js';

describe('parseLogQuery', () => {
  it('returns an all-empty parse for an empty string', () => {
    const q = parseLogQuery('');
    expect(q).toEqual<ParsedQuery>({
      levels: [],
      routes: [],
      minDurationMs: null,
      maxDurationMs: null,
      statuses: [],
      fullText: null,
    });
  });

  it('returns an all-empty parse for space-only input', () => {
    // The tokeniser splits on the literal space char only (its documented separator).
    const q = parseLogQuery('     ');
    expect(q.levels).toEqual([]);
    expect(q.routes).toEqual([]);
    expect(q.statuses).toEqual([]);
    expect(q.fullText).toBeNull();
    expect(q.minDurationMs).toBeNull();
    expect(q.maxDurationMs).toBeNull();
  });

  it('parses a level term and lowercases it', () => {
    const q = parseLogQuery('level:ERROR');
    expect(q.levels).toEqual(['error']);
  });

  it('collects multiple level terms', () => {
    const q = parseLogQuery('level:error level:warn');
    expect(q.levels).toEqual(['error', 'warn']);
  });

  it('parses a route glob term verbatim (glob preserved, not yet LIKE)', () => {
    const q = parseLogQuery('route:/api/sites/*');
    expect(q.routes).toEqual(['/api/sites/*']);
  });

  it('collects multiple route terms', () => {
    const q = parseLogQuery('route:/api/sites/* route:/api/auth/*');
    expect(q.routes).toEqual(['/api/sites/*', '/api/auth/*']);
  });

  it('parses duration> with a seconds unit into ms', () => {
    const q = parseLogQuery('duration>2s');
    expect(q.minDurationMs).toBe(2000);
    expect(q.maxDurationMs).toBeNull();
  });

  it('parses duration> with a minutes unit into ms', () => {
    const q = parseLogQuery('duration>1m');
    expect(q.minDurationMs).toBe(60_000);
  });

  it('parses duration> with an explicit ms unit', () => {
    const q = parseLogQuery('duration>500ms');
    expect(q.minDurationMs).toBe(500);
  });

  it('defaults duration> with no unit to ms', () => {
    const q = parseLogQuery('duration>750');
    expect(q.minDurationMs).toBe(750);
  });

  it('parses duration< (max bound) into ms', () => {
    const q = parseLogQuery('duration<2s');
    expect(q.maxDurationMs).toBe(2000);
    expect(q.minDurationMs).toBeNull();
  });

  it('parses both a min and max duration bound', () => {
    const q = parseLogQuery('duration>500ms duration<5s');
    expect(q.minDurationMs).toBe(500);
    expect(q.maxDurationMs).toBe(5000);
  });

  it('parses a 3-digit status code into a number', () => {
    const q = parseLogQuery('status:500');
    expect(q.statuses).toEqual([500]);
  });

  it('collects multiple status terms', () => {
    const q = parseLogQuery('status:404 status:500');
    expect(q.statuses).toEqual([404, 500]);
  });

  it('treats a non-3-digit status as free text (status:99 does not match)', () => {
    const q = parseLogQuery('status:99');
    expect(q.statuses).toEqual([]);
    expect(q.fullText).toBe('status:99');
  });

  it('captures bare words as free text', () => {
    const q = parseLogQuery('timeout exceeded');
    expect(q.fullText).toBe('timeout exceeded');
  });

  it('strips the surrounding quotes from a quoted phrase', () => {
    const q = parseLogQuery('"connection refused"');
    expect(q.fullText).toBe('connection refused');
  });

  it('ignores the AND keyword (implicit conjunction)', () => {
    const q = parseLogQuery('level:error AND route:/api/*');
    expect(q.levels).toEqual(['error']);
    expect(q.routes).toEqual(['/api/*']);
    expect(q.fullText).toBeNull();
  });

  it('ignores the OR keyword too', () => {
    const q = parseLogQuery('OR foo');
    expect(q.fullText).toBe('foo');
  });

  it('parses a full compound query across every predicate type', () => {
    const q = parseLogQuery('level:error route:/api/sites/* duration>2s status:500 boom');
    expect(q.levels).toEqual(['error']);
    expect(q.routes).toEqual(['/api/sites/*']);
    expect(q.minDurationMs).toBe(2000);
    expect(q.statuses).toEqual([500]);
    expect(q.fullText).toBe('boom');
  });

  it('keeps spaces inside a quoted phrase as a single token', () => {
    const q = parseLogQuery('level:warn "rate limit hit"');
    expect(q.levels).toEqual(['warn']);
    expect(q.fullText).toBe('rate limit hit');
  });

  it('handles an unterminated quote without throwing', () => {
    const q = parseLogQuery('"unclosed phrase');
    // tokeniser flushes the buffer; the leading quote is stripped by the FTS branch
    expect(q.fullText).toBe('unclosed phrase');
  });

  it('joins multiple free-text fragments with a space', () => {
    const q = parseLogQuery('alpha beta gamma');
    expect(q.fullText).toBe('alpha beta gamma');
  });
});

describe('buildWhereClause', () => {
  const empty = (): ParsedQuery => ({
    levels: [],
    routes: [],
    minDurationMs: null,
    maxDurationMs: null,
    statuses: [],
    fullText: null,
  });

  it('emits only the time-range condition for an empty parse', () => {
    const { where, bindings } = buildWhereClause(empty(), '24h');
    expect(where).toBe("WHERE ts >= datetime('now', '-24 hours')");
    expect(bindings).toEqual([]);
  });

  it('maps each supported range token to the correct SQLite modifier', () => {
    expect(buildWhereClause(empty(), '1h').where).toContain("'-1 hours'");
    expect(buildWhereClause(empty(), '6h').where).toContain("'-6 hours'");
    expect(buildWhereClause(empty(), '24h').where).toContain("'-24 hours'");
    expect(buildWhereClause(empty(), '7d').where).toContain("'-7 days'");
    expect(buildWhereClause(empty(), '30d').where).toContain("'-30 days'");
  });

  it('falls back to -24 hours for an unknown range token', () => {
    const { where } = buildWhereClause(empty(), 'bogus');
    expect(where).toContain("'-24 hours'");
  });

  it('defaults the range to 24h when omitted', () => {
    const { where } = buildWhereClause(empty());
    expect(where).toContain("'-24 hours'");
  });

  it('adds an IN clause with one placeholder per level + binds them', () => {
    const q = { ...empty(), levels: ['error', 'warn'] };
    const { where, bindings } = buildWhereClause(q);
    expect(where).toContain('level IN (?, ?)');
    expect(bindings).toEqual(['error', 'warn']);
  });

  it('translates route glob * to SQL LIKE % and ? to _', () => {
    const q = { ...empty(), routes: ['/api/sites/*', '/api/x?'] };
    const { where, bindings } = buildWhereClause(q);
    expect(where).toContain('(route LIKE ? OR route LIKE ?)');
    expect(bindings).toEqual(['/api/sites/%', '/api/x_']);
  });

  it('adds a >= duration condition for a min bound', () => {
    const q = { ...empty(), minDurationMs: 500 };
    const { where, bindings } = buildWhereClause(q);
    expect(where).toContain('duration_ms >= ?');
    expect(bindings).toEqual([500]);
  });

  it('adds a <= duration condition for a max bound', () => {
    const q = { ...empty(), maxDurationMs: 5000 };
    const { where, bindings } = buildWhereClause(q);
    expect(where).toContain('duration_ms <= ?');
    expect(bindings).toEqual([5000]);
  });

  it('adds both duration bounds in order when both are set', () => {
    const q = { ...empty(), minDurationMs: 100, maxDurationMs: 900 };
    const { where, bindings } = buildWhereClause(q);
    expect(where).toContain('duration_ms >= ?');
    expect(where).toContain('duration_ms <= ?');
    expect(bindings).toEqual([100, 900]);
  });

  it('adds a status IN clause with bindings', () => {
    const q = { ...empty(), statuses: [404, 500] };
    const { where, bindings } = buildWhereClause(q);
    expect(where).toContain('status IN (?, ?)');
    expect(bindings).toEqual([404, 500]);
  });

  it('emits the FTS sub-select with the full-text binding', () => {
    const q = { ...empty(), fullText: 'connection refused' };
    const { where, bindings } = buildWhereClause(q);
    expect(where).toContain('rowid IN (SELECT rowid FROM worker_logs_fts WHERE worker_logs_fts MATCH ?)');
    expect(bindings).toEqual(['connection refused']);
  });

  it('AND-joins every condition and orders bindings predictably', () => {
    const q: ParsedQuery = {
      levels: ['error'],
      routes: ['/api/sites/*'],
      minDurationMs: 2000,
      maxDurationMs: null,
      statuses: [500],
      fullText: 'boom',
    };
    const { where, bindings } = buildWhereClause(q, '7d');
    expect(where.startsWith("WHERE ts >= datetime('now', '-7 days')")).toBe(true);
    // 6 AND-joined conditions: ts(no binding) + level + route(glob→LIKE) + duration + status + fts
    expect(where.split(' AND ').length).toBe(6);
    expect(bindings).toEqual(['error', '/api/sites/%', 2000, 500, 'boom']);
  });

  it('never returns an empty WHERE — the time range is always present', () => {
    const { where } = buildWhereClause(empty());
    expect(where.startsWith('WHERE ')).toBe(true);
  });
});

describe('parse → build round-trip', () => {
  it('feeds parseLogQuery output straight into buildWhereClause', () => {
    const parsed = parseLogQuery('level:error route:/api/* duration>1s status:503 fatal');
    const { where, bindings } = buildWhereClause(parsed, '6h');
    expect(where).toContain("'-6 hours'");
    expect(where).toContain('level IN (?)');
    expect(where).toContain('route LIKE ?');
    expect(where).toContain('duration_ms >= ?');
    expect(where).toContain('status IN (?)');
    expect(where).toContain('worker_logs_fts MATCH ?');
    expect(bindings).toEqual(['error', '/api/%', 1000, 503, 'fatal']);
  });
});

describe('LogSearchParams shape', () => {
  it('accepts the documented pagination + range params', () => {
    const params: LogSearchParams = {
      query: 'level:error',
      range: '7d',
      limit: 50,
      cursor: '2026-06-01T00:00:00.000Z',
    };
    const parsed = parseLogQuery(params.query);
    const { where } = buildWhereClause(parsed, params.range);
    expect(parsed.levels).toEqual(['error']);
    expect(where).toContain("'-7 days'");
    expect(params.limit).toBe(50);
    expect(params.cursor).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('works with only the required query field', () => {
    const params: LogSearchParams = { query: 'timeout' };
    const parsed = parseLogQuery(params.query);
    expect(parsed.fullText).toBe('timeout');
  });
});
