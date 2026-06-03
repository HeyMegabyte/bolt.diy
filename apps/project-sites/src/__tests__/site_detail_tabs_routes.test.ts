/**
 * Route coverage for the per-project `/admin/sites/:id` tab endpoints
 * (`src/routes/site_detail_tabs.ts`, convergence r43).
 *
 * Exercises each handler end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries (the `db.js` helpers, the
 * audit writer, and the raw `c.env.DB.prepare` D1 path used by the SQL console).
 *
 * Coverage per tab:
 *   GET    /api/sites/:siteId/logs/tail                  — auth 401, aggregation, empty
 *   POST   /api/sites/:siteId/snapshots/:snapId/rollback — auth 401, 404 non-leak, success
 *   POST   /api/sites/:siteId/sql/exec                   — auth 401, Zod 400, read-only 400,
 *                                                          DDL 400, 404 non-leak, success, error
 *   GET    /api/sites/:siteId/integrations               — auth 401, status mapping, empty
 *   DELETE /api/sites/:siteId/integrations/:key          — auth 401, soft-delete + audit
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn(),
  dbQueryOne: jest.fn(),
  dbExecute: jest.fn(),
}));
jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { siteDetailTabs } from '../routes/site_detail_tabs.js';
import { dbQuery, dbQueryOne, dbExecute } from '../services/db.js';
import { writeAuditLog } from '../services/audit.js';

const mockDbQuery = dbQuery as unknown as jest.Mock;
const mockDbQueryOne = dbQueryOne as unknown as jest.Mock;
const mockDbExecute = dbExecute as unknown as jest.Mock;
const mockWriteAuditLog = writeAuditLog as unknown as jest.Mock;

// ─── Boundary harness ──────────────────────────────────────────────────────────

/** D1 mock whose `prepare(...).all()` resolves to `rows` (or throws). */
function makeDb(rows: Array<Record<string, unknown>> = [], opts: { throws?: boolean } = {}) {
  const all = jest.fn(async () => {
    if (opts.throws) throw new Error('SQLITE_ERROR: no such table');
    return { results: rows };
  });
  const prepare = jest.fn(() => ({ all }));
  return { prepare, _all: all } as unknown as D1Database & {
    prepare: jest.Mock;
    _all: jest.Mock;
  };
}

function makeEnv(db: D1Database): Env {
  return { ENVIRONMENT: 'test', DB: db } as unknown as Env;
}

/**
 * Build the app with a middleware that seeds the auth context vars the
 * handlers read (`userId`, `orgId`). Passing no vars simulates an
 * unauthenticated request.
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', siteDetailTabs);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

function req(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  path: string,
  init: RequestInit,
  env: Env,
) {
  return app.request(path, init, env, makeCtx());
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };
const SITE = 'site-1';

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteAuditLog.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/sites/:siteId/logs/tail', () => {
  const PATH = `/api/sites/${SITE}/logs/tail`;

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv(makeDb());
    const res = await req(makeApp(), PATH, { method: 'GET' }, env);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('maps audit rows to leveled log entries, scoped by org + site', async () => {
    mockDbQuery.mockResolvedValueOnce({
      data: [
        { created_at: '2026-06-03T00:00:00Z', actor_id: 'u-9', action: 'site.deploy', target_id: SITE, message: 'Deployed', metadata_json: null },
        { created_at: '2026-06-03T00:01:00Z', actor_id: null, action: 'build.error.fatal', target_id: SITE, message: null, metadata_json: null },
        { created_at: '2026-06-03T00:02:00Z', actor_id: 'u-3', action: 'cache.warn.miss', target_id: SITE, message: 'miss', metadata_json: null },
      ],
    });
    const env = makeEnv(makeDb());
    const res = await req(makeApp(AUTH), PATH, { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { logs: Array<{ level: string; source: string; message: string }> };
    expect(json.logs).toHaveLength(3);
    expect(json.logs[0]).toMatchObject({ level: 'info', source: 'u-9', message: 'Deployed' });
    expect(json.logs[1]).toMatchObject({ level: 'error', source: 'system', message: 'build.error.fatal' });
    expect(json.logs[2]).toMatchObject({ level: 'warn', source: 'u-3' });
    // Query is org+site scoped.
    expect(mockDbQuery.mock.calls[0][2]).toEqual(['org-1', SITE]);
  });

  it('returns an empty list when there are no audit rows (handles missing data)', async () => {
    mockDbQuery.mockResolvedValueOnce({ data: undefined });
    const env = makeEnv(makeDb());
    const res = await req(makeApp(AUTH), PATH, { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { logs: unknown[] };
    expect(json.logs).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/sites/:siteId/snapshots/:snapshotId/rollback', () => {
  const PATH = `/api/sites/${SITE}/snapshots/snap-1/rollback`;
  const post = (app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env) =>
    req(app, PATH, { method: 'POST' }, env);

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv(makeDb());
    const res = await post(makeApp(), env);
    expect(res.status).toBe(401);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the snapshot is absent or not on this site', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);
    const env = makeEnv(makeDb());
    const res = await post(makeApp(AUTH), env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    // No mutation / audit when the snapshot is not found.
    expect(mockDbExecute).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('promotes the snapshot, bumps the site, and writes an audit row on success', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'snap-1', snapshot_name: 'pre-launch' });
    mockDbExecute.mockResolvedValueOnce(undefined);
    const env = makeEnv(makeDb());
    const res = await post(makeApp(AUTH), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; snapshot_name: string };
    expect(json).toEqual({ ok: true, snapshot_name: 'pre-launch' });
    // UPDATE sites scoped by site + org.
    expect(mockDbExecute.mock.calls[0][2]).toEqual([SITE, 'org-1']);
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({
      action: 'site.snapshot.rollback',
      org_id: 'org-1',
      actor_id: 'user-1',
      target_id: SITE,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('POST /api/sites/:siteId/sql/exec', () => {
  const PATH = `/api/sites/${SITE}/sql/exec`;
  const exec = (app: Hono<{ Bindings: Env; Variables: Variables }>, body: unknown, env: Env) =>
    req(
      app,
      PATH,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv(makeDb());
    const res = await exec(makeApp(), { query: 'SELECT 1' }, env);
    expect(res.status).toBe(401);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails Zod validation (empty query)', async () => {
    const env = makeEnv(makeDb());
    const res = await exec(makeApp(AUTH), { query: '' }, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(false);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('rejects a non-read-only statement before touching the DB', async () => {
    const env = makeEnv(makeDb());
    const res = await exec(makeApp(AUTH), { query: 'PRAGMAX foo' }, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/read-only/i);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('rejects a SELECT that smuggles a forbidden DDL keyword', async () => {
    const env = makeEnv(makeDb());
    const res = await exec(makeApp(AUTH), { query: 'SELECT 1; DROP TABLE users' }, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.error).toMatch(/DDL not allowed/i);
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('returns 404 (non-leak) when the site is not in the org', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);
    const env = makeEnv(makeDb());
    const res = await exec(makeApp(AUTH), { query: 'SELECT * FROM sites' }, env);
    expect(res.status).toBe(404);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/site not found/i);
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('executes a read-only query, returns columns/rows, and audits', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: SITE });
    const db = makeDb([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }]);
    const env = makeEnv(db);
    const res = await exec(makeApp(AUTH), { query: '  SELECT id, name FROM widgets  ' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; columns: string[]; rows: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.columns).toEqual(['id', 'name']);
    expect(json.rows).toHaveLength(2);
    // Trimmed query is what hits prepare().
    expect((db as unknown as { prepare: jest.Mock }).prepare).toHaveBeenCalledWith('SELECT id, name FROM widgets');
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({ action: 'site.sql.exec', target_id: SITE });
  });

  it('returns ok:true with empty columns when the result set is empty', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: SITE });
    const env = makeEnv(makeDb([]));
    const res = await exec(makeApp(AUTH), { query: 'SELECT 1 WHERE 1=0' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; columns: string[]; rows: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.columns).toEqual([]);
    expect(json.rows).toEqual([]);
  });

  it('returns 400 with the engine message when the query throws at runtime', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: SITE });
    const env = makeEnv(makeDb([], { throws: true }));
    const res = await exec(makeApp(AUTH), { query: 'SELECT * FROM nope' }, env);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json.ok).toBe(false);
    expect(json.error).toMatch(/no such table/i);
    // Failed query is not audited.
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('GET /api/sites/:siteId/integrations', () => {
  const PATH = `/api/sites/${SITE}/integrations`;

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv(makeDb());
    const res = await req(makeApp(), PATH, { method: 'GET' }, env);
    expect(res.status).toBe(401);
    expect(mockDbQuery).not.toHaveBeenCalled();
  });

  it('marks connected providers and leaves the rest disconnected', async () => {
    mockDbQuery.mockResolvedValueOnce({ data: [{ provider: 'stripe' }, { provider: 'github' }] });
    const env = makeEnv(makeDb());
    const res = await req(makeApp(AUTH), PATH, { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      providers: Array<{ key: string; status: string }>;
    };
    const byKey = Object.fromEntries(json.providers.map((p) => [p.key, p.status]));
    expect(byKey['stripe']).toBe('connected');
    expect(byKey['github']).toBe('connected');
    expect(byKey['mailchimp']).toBe('disconnected');
    expect(byKey['resend']).toBe('disconnected');
    // Full provider catalog is always returned.
    expect(json.providers).toHaveLength(7);
  });

  it('returns every provider disconnected when no connections exist', async () => {
    mockDbQuery.mockResolvedValueOnce({ data: [] });
    const env = makeEnv(makeDb());
    const res = await req(makeApp(AUTH), PATH, { method: 'GET' }, env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { providers: Array<{ status: string }> };
    expect(json.providers.every((p) => p.status === 'disconnected')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('DELETE /api/sites/:siteId/integrations/:key', () => {
  const PATH = `/api/sites/${SITE}/integrations/stripe`;
  const del = (app: Hono<{ Bindings: Env; Variables: Variables }>, env: Env) =>
    req(app, PATH, { method: 'DELETE' }, env);

  it('returns 401 when unauthenticated', async () => {
    const env = makeEnv(makeDb());
    const res = await del(makeApp(), env);
    expect(res.status).toBe(401);
    expect(mockDbExecute).not.toHaveBeenCalled();
    expect(mockWriteAuditLog).not.toHaveBeenCalled();
  });

  it('soft-deletes the connection and writes a disconnect audit row', async () => {
    mockDbExecute.mockResolvedValueOnce(undefined);
    const env = makeEnv(makeDb());
    const res = await del(makeApp(AUTH), env);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    // Soft-delete scoped by site + provider.
    expect(mockDbExecute.mock.calls[0][2]).toEqual([SITE, 'stripe']);
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditLog.mock.calls[0][1]).toMatchObject({
      action: 'site.integrations.disconnect',
      target_id: SITE,
      metadata_json: { provider: 'stripe' },
    });
  });
});
