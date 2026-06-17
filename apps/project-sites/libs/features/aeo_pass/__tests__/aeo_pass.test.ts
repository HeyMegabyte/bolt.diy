/**
 * Unit + route-layer tests for the aeo_pass feature module.
 *
 * All external deps (D1, feature flags) are mocked — no network/DB calls.
 * Covers the service (runAeoAudit / getLatestAeoAudit) and every route
 * (flag-off 404, no-auth 401, valid POST 200, GET with no data, GET after POST).
 */

import { Hono } from 'hono';

// ─── Mocks (must precede service/handler imports) ───────────────────────────

const mockDbInsert = jest.fn();
const mockDbQueryOne = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbInsert: (...a: unknown[]) => mockDbInsert(...a),
  dbQuery: jest.fn(),
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbExecute: jest.fn(),
}));

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

import { runAeoAudit, getLatestAeoAudit } from '../service.js';
import { aeoPass } from '../handlers.js';

const env = { DB: {} } as never;

/** Mount the handler under a parent app that optionally injects an authed user. */
function appWith(userId?: string): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.route('/', aeoPass);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbInsert.mockResolvedValue(undefined);
  mockDbQueryOne.mockResolvedValue(null);
  mockIsFlagOn.mockResolvedValue(true);
});

// ─── service: runAeoAudit ────────────────────────────────────────────────────

describe('runAeoAudit', () => {
  it('inserts a row and returns a typed AeoAudit', async () => {
    const result = await runAeoAudit(env, 'site_abc');

    expect(typeof result.id).toBe('string');
    expect(result.siteId).toBe('site_abc');
    expect(result.score).toBe(72);
    expect(result.issues).toEqual([
      'Missing FAQ schema',
      'No quotable answer blocks',
      'Insufficient structured data',
    ]);
    expect(mockDbInsert).toHaveBeenCalledTimes(1);

    const [, table, row] = mockDbInsert.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(table).toBe('aeo_audits');
    expect(row).toMatchObject({ site_id: 'site_abc', score: 72 });
  });
});

// ─── service: getLatestAeoAudit ──────────────────────────────────────────────

describe('getLatestAeoAudit', () => {
  it('returns null when no audit exists', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const result = await getLatestAeoAudit(env, 'site_xyz');
    expect(result).toBeNull();
  });

  it('maps the D1 row to a typed AeoAudit', async () => {
    mockDbQueryOne.mockResolvedValue({
      id: 'audit_1',
      site_id: 'site_xyz',
      org_id: null,
      score: 72,
      issues: JSON.stringify(['Missing FAQ schema']),
      created_at: '2026-06-17T00:00:00.000Z',
    });

    const result = await getLatestAeoAudit(env, 'site_xyz');
    expect(result).toMatchObject({
      id: 'audit_1',
      siteId: 'site_xyz',
      score: 72,
      issues: ['Missing FAQ schema'],
    });
  });
});

// ─── POST /api/aeo/audit/:siteId ─────────────────────────────────────────────

describe('POST /api/aeo/audit/:siteId', () => {
  it('returns 404 when the flag is off (no leak)', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await appWith('user_1').request('/api/aeo/audit/site_abc', { method: 'POST' }, env);
    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 401 when not authenticated', async () => {
    const res = await appWith().request('/api/aeo/audit/site_abc', { method: 'POST' }, env);
    expect(res.status).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('returns 200 with audit object for an authed request', async () => {
    const res = await appWith('user_1').request('/api/aeo/audit/site_abc', { method: 'POST' }, env);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean; audit: { siteId: string; score: number; issues: string[] } };
    expect(json.ok).toBe(true);
    expect(json.audit.siteId).toBe('site_abc');
    expect(json.audit.score).toBe(72);
    expect(json.audit.issues).toHaveLength(3);
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });
});

// ─── GET /api/aeo/:siteId ────────────────────────────────────────────────────

describe('GET /api/aeo/:siteId', () => {
  it('returns 404 when the flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await appWith('user_1').request('/api/aeo/site_abc', {}, env);
    expect(res.status).toBe(404);
  });

  it('returns 401 when not authenticated', async () => {
    const res = await appWith().request('/api/aeo/site_abc', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns { ok: true, audit: null } when no audit exists', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const res = await appWith('user_1').request('/api/aeo/site_abc', {}, env);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean; audit: null };
    expect(json.ok).toBe(true);
    expect(json.audit).toBeNull();
  });

  it('returns the latest audit when one exists', async () => {
    mockDbQueryOne.mockResolvedValue({
      id: 'audit_1',
      site_id: 'site_abc',
      org_id: null,
      score: 72,
      issues: JSON.stringify(['Missing FAQ schema']),
      created_at: '2026-06-17T00:00:00.000Z',
    });

    const res = await appWith('user_1').request('/api/aeo/site_abc', {}, env);
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean; audit: { id: string; score: number } };
    expect(json.ok).toBe(true);
    expect(json.audit.id).toBe('audit_1');
    expect(json.audit.score).toBe(72);
  });
});
