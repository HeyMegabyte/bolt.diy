/**
 * Unit tests for the visitor DSAR (GDPR/CCPA data-subject-access-request) handler.
 *
 * Mocks: feature flag gate, db helpers.
 * Covers: flag-off → 404, no orgId → 401, foreign site → 404,
 *         export mode, delete mode, audit log write.
 */
import { Hono } from 'hono';

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockDbQuery = jest.fn();
const mockDbQueryOne = jest.fn();
const mockDbInsert = jest.fn();
const mockDbExecute = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbQuery: (...a: unknown[]) => mockDbQuery(...a),
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbInsert: (...a: unknown[]) => mockDbInsert(...a),
  dbExecute: (...a: unknown[]) => mockDbExecute(...a),
}));

import { visitorDsar } from '../handlers.js';

/** Build a minimal Hono test app with the feature sub-router mounted. */
function buildApp(overrides: { orgId?: string; userId?: string } = {}) {
  const a = new Hono<{ Variables: { orgId?: string; userId?: string } }>();
  // Simulate what the auth middleware sets
  a.use('*', async (c, next) => {
    if (overrides.orgId !== undefined) c.set('orgId', overrides.orgId);
    if (overrides.userId !== undefined) c.set('userId', overrides.userId);
    await next();
  });
  a.route('/', visitorDsar);
  return a;
}

const execCtx = { waitUntil() {}, passThroughOnException() {} } as never;

function makeRequest(body: unknown, siteId = 'site-001') {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbInsert.mockResolvedValue({ error: null });
  mockDbExecute.mockResolvedValue({ error: null, changes: 0 });
  mockDbQuery.mockResolvedValue({ data: [], error: null });
  mockDbQueryOne.mockResolvedValue(null);
});

// ─── Flag gate ────────────────────────────────────────────────────────────────

describe('flag gate', () => {
  it('returns 404 when flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'export' }),
      {} as never,
      execCtx,
    );
    expect(res.status).toBe(404);
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('auth', () => {
  beforeEach(() => {
    mockIsFlagOn.mockResolvedValue(true);
  });

  it('returns 401 when orgId is absent', async () => {
    const res = await buildApp().request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'export' }),
      {} as never,
      execCtx,
    );
    expect(res.status).toBe(401);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('body validation', () => {
  beforeEach(() => {
    mockIsFlagOn.mockResolvedValue(true);
    // Ownership check passes
    mockDbQueryOne.mockResolvedValue({ id: 'site-001' });
  });

  it('returns 400 when subject is empty', async () => {
    const res = await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: '', mode: 'export' }),
      {} as never,
      execCtx,
    );
    expect(res.status).toBe(400);
    const json = await res.json<{ error: string; issues: unknown[] }>();
    expect(json.error).toBe('Validation failed');
  });

  it('returns 400 when mode is invalid', async () => {
    const res = await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'vis_abc', mode: 'unknown' }),
      {} as never,
      execCtx,
    );
    expect(res.status).toBe(400);
  });
});

// ─── Site ownership ───────────────────────────────────────────────────────────

describe('site ownership', () => {
  beforeEach(() => {
    mockIsFlagOn.mockResolvedValue(true);
  });

  it('returns 404 when site does not belong to org', async () => {
    mockDbQueryOne.mockResolvedValue(null); // no matching site
    const res = await buildApp({ orgId: 'org-evil' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'export' }),
      {} as never,
      execCtx,
    );
    expect(res.status).toBe(404);
  });
});

// ─── Export mode ──────────────────────────────────────────────────────────────

describe('export mode', () => {
  const fakeRecord = {
    id: 'vi-1',
    org_id: 'org-1',
    site_id: 'site-001',
    email: 'user@example.com',
    phone: null,
    visitor_id: null,
    anon_id: null,
    display_name: null,
    first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-06-01T00:00:00Z',
    channel_flags: '{}',
    metadata_json: '{}',
  };

  beforeEach(() => {
    mockIsFlagOn.mockResolvedValue(true);
    // ownership OK then query results
    mockDbQueryOne.mockResolvedValue({ id: 'site-001' });
    mockDbQuery.mockResolvedValue({ data: [fakeRecord], error: null });
  });

  it('returns 200 with mode:export and records', async () => {
    const res = await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'export' }),
      {} as never,
      execCtx,
    );
    expect(res.status).toBe(200);
    const json = await res.json<{ mode: string; records: unknown[]; count: number }>();
    expect(json.mode).toBe('export');
    expect(json.records).toHaveLength(1);
    expect(json.count).toBe(1);
  });

  it('queries visitor_identities by email when subject is an email', async () => {
    await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'export' }),
      {} as never,
      execCtx,
    );
    // The first dbQuery call after dbQueryOne (ownership) is the visitor lookup
    const [, sql, params] = mockDbQuery.mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toContain('email = ?');
    expect(params).toContain('user@example.com');
  });

  it('queries visitor_identities by visitor_id when subject is not an email', async () => {
    await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'vis_abc123', mode: 'export' }),
      {} as never,
      execCtx,
    );
    const [, sql, params] = mockDbQuery.mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toContain('visitor_id = ?');
    expect(params).toContain('vis_abc123');
  });

  it('writes an audit log entry for export', async () => {
    await buildApp({ orgId: 'org-1', userId: 'user-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'export' }),
      {} as never,
      execCtx,
    );
    expect(mockDbInsert).toHaveBeenCalledWith(
      undefined,
      'audit_logs',
      expect.objectContaining({
        action: 'dsar.export',
        org_id: 'org-1',
        target_type: 'visitor_identity',
        target_id: 'site-001',
      }),
    );
  });
});

// ─── Delete mode ──────────────────────────────────────────────────────────────

describe('delete mode', () => {
  beforeEach(() => {
    mockIsFlagOn.mockResolvedValue(true);
    mockDbQueryOne.mockResolvedValue({ id: 'site-001' });
    mockDbExecute.mockResolvedValue({ error: null, changes: 2 });
  });

  it('returns 200 with mode:delete and deleted count', async () => {
    const res = await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'delete' }),
      {} as never,
      execCtx,
    );
    expect(res.status).toBe(200);
    const json = await res.json<{ mode: string; deleted: number }>();
    expect(json.mode).toBe('delete');
    expect(json.deleted).toBe(2);
  });

  it('soft-deletes rows with SET deleted_at', async () => {
    await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'delete' }),
      {} as never,
      execCtx,
    );
    const [, sql] = mockDbExecute.mock.calls[0] as [unknown, string, unknown[]];
    expect(sql).toContain("deleted_at = datetime('now')");
    expect(sql).toContain('visitor_identities');
  });

  it('writes an audit log entry for delete', async () => {
    await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'delete' }),
      {} as never,
      execCtx,
    );
    expect(mockDbInsert).toHaveBeenCalledWith(
      undefined,
      'audit_logs',
      expect.objectContaining({
        action: 'dsar.delete',
        org_id: 'org-1',
      }),
    );
  });

  it('cascades — purges correlated visitor_events + reports combined receipt (Art.17)', async () => {
    // Subject resolves to identities carrying client ids → events are erased too.
    mockDbQuery.mockResolvedValue({
      data: [{ visitor_id: 'vid-1', anon_id: 'anon-1' }],
      error: null,
    });
    mockDbExecute
      .mockResolvedValueOnce({ error: null, changes: 3 }) // DELETE visitor_events
      .mockResolvedValueOnce({ error: null, changes: 2 }); // UPDATE visitor_identities

    const res = await buildApp({ orgId: 'org-1' }).request(
      '/api/sites/site-001/dsar',
      makeRequest({ subject: 'user@example.com', mode: 'delete' }),
      {} as never,
      execCtx,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{ deleted: number; events_deleted: number }>();
    expect(json.deleted).toBe(2);
    expect(json.events_deleted).toBe(3);

    // First dbExecute call is the events hard-delete, scoped by session_id.
    const [, eventsSql, eventsParams] = mockDbExecute.mock.calls[0] as [unknown, string, unknown[]];
    expect(eventsSql).toContain('DELETE FROM visitor_events');
    expect(eventsSql).toContain('session_id IN');
    expect(eventsParams).toEqual(expect.arrayContaining(['vid-1', 'anon-1']));

    // Audit receipt records the combined count (identities + events).
    expect(mockDbInsert).toHaveBeenCalledWith(
      undefined,
      'audit_logs',
      expect.objectContaining({ action: 'dsar.delete', metadata_json: expect.stringContaining('5') }),
    );
  });
});
