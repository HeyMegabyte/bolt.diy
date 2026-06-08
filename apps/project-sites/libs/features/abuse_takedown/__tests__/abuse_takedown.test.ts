/**
 * Unit + route-layer tests for the abuse_takedown feature module.
 *
 * All external deps (D1, feature flags, rate-limit) are mocked — no network/DB.
 * Covers the service (create / list / resolve incl. site archive on takedown)
 * and every route (flag-off 404, bad body 400, unknown site 404, valid 202;
 * list 401/403/200; resolve 401/403/404/200).
 */

import { Hono } from 'hono';

// ─── Mocks (must precede service/handler imports) ───────────────────────────

const mockDbInsert = jest.fn();
const mockDbQuery = jest.fn();
const mockDbQueryOne = jest.fn();
const mockDbExecute = jest.fn();
jest.mock('../../../../src/services/db.js', () => ({
  dbInsert: (...a: unknown[]) => mockDbInsert(...a),
  dbQuery: (...a: unknown[]) => mockDbQuery(...a),
  dbQueryOne: (...a: unknown[]) => mockDbQueryOne(...a),
  dbExecute: (...a: unknown[]) => mockDbExecute(...a),
}));

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

// Rate-limit middleware → no-op pass-through in tests.
jest.mock('../../../../src/middleware/rate_limit.js', () => ({
  rateLimitMiddleware: () => async (_c: unknown, next: () => Promise<void>) => next(),
}));

import {
  createAbuseReport,
  listAbuseReports,
  resolveAbuseReport,
  resolveReportedSite,
} from '../service.js';
import { abuseTakedown } from '../handlers.js';

const env = { DB: {} } as never;

/** Default db routing by SQL fragment so one mock serves sites/users/reports lookups. */
function routeDbQueryOne(opts: {
  site?: unknown;
  superAdmin?: unknown;
  report?: unknown;
} = {}): void {
  mockDbQueryOne.mockImplementation((_db: unknown, sql: string) => {
    if (/FROM sites/i.test(sql)) return Promise.resolve(opts.site ?? null);
    if (/is_super_admin/i.test(sql)) return Promise.resolve(opts.superAdmin ?? null);
    if (/FROM abuse_reports/i.test(sql)) return Promise.resolve(opts.report ?? null);
    return Promise.resolve(null);
  });
}

/** Mount the handler under a parent app that injects an optional authed user. */
function appWith(userId?: string): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (userId) c.set('userId' as never, userId as never);
    await next();
  });
  app.route('/', abuseTakedown);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbInsert.mockResolvedValue(undefined);
  mockDbExecute.mockResolvedValue(undefined);
  mockDbQuery.mockResolvedValue({ data: [] });
  mockIsFlagOn.mockResolvedValue(true);
  routeDbQueryOne();
});

// ─── service ────────────────────────────────────────────────────────────────

describe('createAbuseReport', () => {
  it('inserts a pending report against the resolved site', async () => {
    const res = await createAbuseReport(
      env,
      { site: 'acme', category: 'dmca', reason: 'copyright violation on /gallery' },
      { id: 'site_9', org_id: 'org_1' },
    );
    expect(res.status).toBe('pending');
    expect(typeof res.id).toBe('string');
    const [, table, record] = mockDbInsert.mock.calls[0];
    expect(table).toBe('abuse_reports');
    expect(record).toMatchObject({ site_id: 'site_9', org_id: 'org_1', category: 'dmca', status: 'pending' });
  });
});

describe('listAbuseReports', () => {
  it('filters by status when given', async () => {
    mockDbQuery.mockResolvedValue({ data: [{ id: 'r1' }] });
    const rows = await listAbuseReports(env, 'pending');
    expect(rows).toEqual([{ id: 'r1' }]);
    const [, sql, params] = mockDbQuery.mock.calls[0];
    expect(sql).toMatch(/status = \?/);
    expect(params).toEqual(['pending']);
  });
});

describe('resolveAbuseReport', () => {
  it('takedown archives the offending site + marks the report upheld', async () => {
    routeDbQueryOne({ report: { id: 'r1', site_id: 'site_9' } });
    // second dbQueryOne (re-read of the updated report) → return final shape
    mockDbQueryOne
      .mockResolvedValueOnce({ id: 'r1', site_id: 'site_9' }) // initial load
      .mockResolvedValueOnce({ id: 'r1', status: 'upheld_takedown', site_id: 'site_9' }); // re-read
    const out = await resolveAbuseReport(env, 'r1', 'takedown', 'confirmed', 'admin_1');
    expect(out?.status).toBe('upheld_takedown');
    // two dbExecute calls: update report + archive site
    expect(mockDbExecute).toHaveBeenCalledTimes(2);
    const archiveCall = mockDbExecute.mock.calls.find((c) => /UPDATE sites/i.test(c[1]));
    expect(archiveCall).toBeTruthy();
    expect(archiveCall?.[1]).toMatch(/status = 'archived'/);
  });

  it('dismiss closes the report WITHOUT archiving the site', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce({ id: 'r1', site_id: 'site_9' })
      .mockResolvedValueOnce({ id: 'r1', status: 'dismissed', site_id: 'site_9' });
    const out = await resolveAbuseReport(env, 'r1', 'dismiss', undefined, 'admin_1');
    expect(out?.status).toBe('dismissed');
    expect(mockDbExecute).toHaveBeenCalledTimes(1); // report update only, no site archive
    expect(mockDbExecute.mock.calls.some((c) => /UPDATE sites/i.test(c[1]))).toBe(false);
  });

  it('returns null for an unknown / already-resolved report (no writes)', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const out = await resolveAbuseReport(env, 'missing', 'takedown', undefined, 'admin_1');
    expect(out).toBeNull();
    expect(mockDbExecute).not.toHaveBeenCalled();
  });
});

describe('resolveReportedSite', () => {
  it('looks up by slug OR id', async () => {
    routeDbQueryOne({ site: { id: 'site_9', org_id: 'org_1' } });
    const site = await resolveReportedSite(env, 'acme');
    expect(site).toEqual({ id: 'site_9', org_id: 'org_1' });
  });
});

// ─── routes ───────────────────────────────────────────────────────────────

describe('POST /api/abuse/report', () => {
  const body = (o: Record<string, unknown>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(o),
  });

  it('404s when the flag is off (no leak)', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await appWith().request('/api/abuse/report', body({ site: 'acme', category: 'dmca', reason: 'xxxxxxxx' }), env);
    expect(res.status).toBe(404);
  });

  it('400s on an invalid body', async () => {
    const res = await appWith().request('/api/abuse/report', body({ site: 'acme', category: 'dmca' }), env); // missing reason
    expect(res.status).toBe(400);
  });

  it('404s when the reported site is unknown', async () => {
    routeDbQueryOne({ site: null });
    const res = await appWith().request('/api/abuse/report', body({ site: 'ghost', category: 'spam', reason: 'spammy content here' }), env);
    expect(res.status).toBe(404);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('202s + inserts a pending report for a valid submission', async () => {
    routeDbQueryOne({ site: { id: 'site_9', org_id: 'org_1' } });
    const res = await appWith().request('/api/abuse/report', body({ site: 'acme', category: 'illegal', reason: 'illegal content on the homepage' }), env);
    expect(res.status).toBe(202);
    const json = (await res.json()) as { ok: boolean; status: string };
    expect(json.ok).toBe(true);
    expect(json.status).toBe('pending');
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/abuse/reports (super-admin)', () => {
  it('401s without auth', async () => {
    const res = await appWith().request('/api/abuse/reports', {}, env);
    expect(res.status).toBe(401);
  });

  it('403s for a non-super-admin', async () => {
    routeDbQueryOne({ superAdmin: { is_super_admin: 0 } });
    const res = await appWith('user_1').request('/api/abuse/reports', {}, env);
    expect(res.status).toBe(403);
  });

  it('200s + returns the queue for a super-admin', async () => {
    routeDbQueryOne({ superAdmin: { is_super_admin: 1 } });
    mockDbQuery.mockResolvedValue({ data: [{ id: 'r1', status: 'pending' }] });
    const res = await appWith('admin_1').request('/api/abuse/reports', {}, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { reports: unknown[] };
    expect(json.reports).toHaveLength(1);
  });
});

describe('POST /api/abuse/reports/:id/resolve (super-admin)', () => {
  const body = (o: Record<string, unknown>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(o),
  });

  it('401s without auth', async () => {
    const res = await appWith().request('/api/abuse/reports/r1/resolve', body({ action: 'dismiss' }), env);
    expect(res.status).toBe(401);
  });

  it('403s for a non-super-admin', async () => {
    routeDbQueryOne({ superAdmin: { is_super_admin: 0 } });
    const res = await appWith('user_1').request('/api/abuse/reports/r1/resolve', body({ action: 'dismiss' }), env);
    expect(res.status).toBe(403);
  });

  it('404s when the report is unknown', async () => {
    mockDbQueryOne.mockImplementation((_db: unknown, sql: string) =>
      Promise.resolve(/is_super_admin/i.test(sql) ? { is_super_admin: 1 } : null),
    );
    const res = await appWith('admin_1').request('/api/abuse/reports/missing/resolve', body({ action: 'takedown' }), env);
    expect(res.status).toBe(404);
  });

  it('200s + resolves for a super-admin', async () => {
    let reportReads = 0;
    mockDbQueryOne.mockImplementation((_db: unknown, sql: string) => {
      if (/is_super_admin/i.test(sql)) return Promise.resolve({ is_super_admin: 1 });
      if (/FROM abuse_reports/i.test(sql)) {
        reportReads += 1;
        return Promise.resolve(
          reportReads === 1
            ? { id: 'r1', site_id: 'site_9' }
            : { id: 'r1', status: 'upheld_takedown', site_id: 'site_9' },
        );
      }
      return Promise.resolve(null);
    });
    const res = await appWith('admin_1').request('/api/abuse/reports/r1/resolve', body({ action: 'takedown', note: 'confirmed' }), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; report: { status: string } };
    expect(json.ok).toBe(true);
    expect(json.report.status).toBe('upheld_takedown');
  });
});
