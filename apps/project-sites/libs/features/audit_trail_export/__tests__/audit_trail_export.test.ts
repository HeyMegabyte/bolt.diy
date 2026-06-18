/**
 * Tests for the audit_trail_export feature module.
 * Covers: rowsToCsv unit tests, org-scoping (query never omits org_id),
 * flag-off 404, no-orgId 401, validation 400, and happy-path JSON + CSV.
 */
import { Hono } from 'hono';

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockDbQuery = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbQuery: (...a: unknown[]) => mockDbQuery(...a),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({}),
  dbExecute: jest.fn().mockResolvedValue(undefined),
}));

import { rowsToCsv, buildAuditQuery, FLAG_KEY } from '../service.js';
import { auditTrailExport } from '../handlers.js';
import type { AuditLogEntry } from '../schemas.js';

// ---------------------------------------------------------------------------
// App factory — mounts auditTrailExport at /api/audit/export
// ---------------------------------------------------------------------------
function app(orgId: string | null = null) {
  const a = new Hono();
  a.use('*', async (c, next) => {
    if (orgId !== null) (c as unknown as { set: (k: string, v: string) => void }).set('orgId', orgId);
    await next();
  });
  a.route('/api/audit/export', auditTrailExport);
  return a;
}

const GET = (qs = '', orgId: string | null = 'org-123') =>
  app(orgId).request(
    `/api/audit/export${qs ? `?${qs}` : ''}`,
    { method: 'GET' },
    {} as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );

const ENTRY: AuditLogEntry = {
  id: 'log-001',
  org_id: 'org-123',
  actor_id: 'user-abc',
  action: 'site.created',
  target_type: 'site',
  target_id: 'site-xyz',
  request_id: 'req-001',
  created_at: '2026-06-18T10:00:00Z',
};

beforeEach(() => {
  mockIsFlagOn.mockReset();
  mockDbQuery.mockReset();
});

// ---------------------------------------------------------------------------
// 1. rowsToCsv unit tests
// ---------------------------------------------------------------------------
describe('rowsToCsv()', () => {
  it('produces a header row and one data row', () => {
    const csv = rowsToCsv([ENTRY]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,org_id,actor_id,action,target_type,target_id,request_id,created_at');
    expect(lines[1]).toContain('log-001');
    expect(lines[1]).toContain('site.created');
  });

  it('returns only the header row for an empty array', () => {
    const csv = rowsToCsv([]);
    expect(csv).toBe('id,org_id,actor_id,action,target_type,target_id,request_id,created_at');
  });

  it('escapes double-quotes in cell values', () => {
    const row: AuditLogEntry = { ...ENTRY, action: 'say "hello"' };
    const csv = rowsToCsv([row]);
    expect(csv).toContain('"say ""hello"""');
  });

  it('escapes commas in cell values', () => {
    const row: AuditLogEntry = { ...ENTRY, action: 'a,b' };
    const csv = rowsToCsv([row]);
    expect(csv).toContain('"a,b"');
  });

  it('renders null cells as empty strings', () => {
    const row: AuditLogEntry = { ...ENTRY, actor_id: null, target_type: null };
    const csv = rowsToCsv([row]);
    // actor_id and target_type columns should be empty (consecutive commas)
    const dataLine = csv.split('\r\n')[1];
    // id,org_id,,action,,target_id,request_id,created_at
    expect(dataLine).toMatch(/org-123,,site\.created,,site-xyz/);
  });
});

// ---------------------------------------------------------------------------
// 2. buildAuditQuery — org_id scoping
// ---------------------------------------------------------------------------
describe('buildAuditQuery()', () => {
  it('always includes org_id = ? as the first condition', () => {
    const { sql, params } = buildAuditQuery('org-123', {
      limit: 10,
      format: 'json',
    });
    expect(sql).toContain('org_id = ?');
    expect(params[0]).toBe('org-123');
  });

  it('appends action filter when provided', () => {
    const { sql, params } = buildAuditQuery('org-123', {
      action: 'site.created',
      limit: 10,
      format: 'json',
    });
    expect(sql).toContain('action = ?');
    expect(params).toContain('site.created');
  });

  it('appends from/to filters when provided', () => {
    const { sql, params } = buildAuditQuery('org-123', {
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T23:59:59Z',
      limit: 10,
      format: 'json',
    });
    expect(sql).toContain('created_at >= ?');
    expect(sql).toContain('created_at <= ?');
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-12-31T23:59:59Z');
  });

  it('uses LIMIT ? as the last param', () => {
    const { params } = buildAuditQuery('org-123', { limit: 42, format: 'json' });
    expect(params[params.length - 1]).toBe(42);
  });

  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('audit_trail_export');
  });
});

// ---------------------------------------------------------------------------
// 3. Flag off → 404
// ---------------------------------------------------------------------------
describe('GET /api/audit/export — flag gate', () => {
  it('returns 404 when the audit_trail_export flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 4. No orgId → 401
// ---------------------------------------------------------------------------
describe('GET /api/audit/export — auth', () => {
  it('returns 401 when no orgId is present', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET('', null);
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// 5. Bad query params → 400
// ---------------------------------------------------------------------------
describe('GET /api/audit/export — validation', () => {
  it('returns 400 when limit is out of range', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET('limit=0');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ---------------------------------------------------------------------------
// 6. Happy path — JSON
// ---------------------------------------------------------------------------
describe('GET /api/audit/export — happy path JSON', () => {
  it('returns 200 with count and entries', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    // dbQuery returns DbResult<T> — wrap in { data: [...] }
    mockDbQuery.mockResolvedValue({ data: [ENTRY], error: null });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { count: number; entries: AuditLogEntry[] };
    expect(body.count).toBe(1);
    expect(body.entries[0].id).toBe('log-001');
    expect(body.entries[0].action).toBe('site.created');
  });
});

// ---------------------------------------------------------------------------
// 7. Happy path — CSV
// ---------------------------------------------------------------------------
describe('GET /api/audit/export — happy path CSV', () => {
  it('returns 200 with text/csv and Content-Disposition', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    // dbQuery returns DbResult<T> — wrap in { data: [...] }
    mockDbQuery.mockResolvedValue({ data: [ENTRY], error: null });

    const res = await GET('format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="audit-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = await res.text();
    expect(text).toContain('id,org_id,actor_id,action');
    expect(text).toContain('site.created');
  });
});
