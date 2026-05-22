/**
 * Tests for the site-scoped audit list endpoint at `GET /api/audit-logs`.
 *
 * Covers the new `site_slug` / `site_id` query params, the 500-row cap, and
 * the response shape including the `site` field that the admin ag-grid
 * filters on. The endpoint resolves slug → id (org-scoped), then runs a
 * single parameterized SQL with optional WHERE narrowing and a LEFT JOIN
 * against `sites` for the `site` field.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
  getAuditLogs: jest.fn().mockResolvedValue({ data: [], error: null }),
}));

jest.mock('../lib/sentry.js', () => ({
  captureError: jest.fn(),
  captureMessage: jest.fn(),
  createSentry: jest.fn(),
}));

jest.mock('../lib/posthog.js', () => ({
  capture: jest.fn(),
  trackAuth: jest.fn(),
  trackSite: jest.fn(),
  trackError: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { dbQueryOne } from '../services/db.js';

const mockDbQueryOne = dbQueryOne as jest.Mock;

interface MockRow {
  id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  actor_id: string | null;
  metadata_json: string | null;
  request_id: string | null;
  created_at: string;
  site_slug: string | null;
}

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SITE_ID = '11111111-1111-1111-1111-111111111111';
const SITE_SLUG = 'vitos-mens-salon';

/**
 * Build a D1-shaped mock that captures the bound SQL + params for assertion
 * and returns the supplied `rows` from `.all()`. Mirrors the chained
 * `prepare().bind().all()` shape that the audit-logs handler uses.
 *
 * @example
 * const { db, captured } = makeMockDb([{ id: 'a', ... }]);
 * // ...invoke handler...
 * expect(captured.sql).toContain('FROM audit_logs');
 */
function makeMockDb(rows: MockRow[]): {
  db: D1Database;
  captured: { sql: string; params: unknown[] };
} {
  const captured: { sql: string; params: unknown[] } = { sql: '', params: [] };
  const db = {
    prepare: jest.fn((sql: string) => {
      captured.sql = sql;
      return {
        bind: jest.fn((...params: unknown[]) => {
          captured.params = params;
          return {
            all: jest.fn().mockResolvedValue({ results: rows, success: true }),
          };
        }),
      };
    }),
  } as unknown as D1Database;
  return { db, captured };
}

function createAuthedApp(db: D1Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/', api);
  const env = { ENVIRONMENT: 'test', DB: db } as unknown as Env;
  return { app, env };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/audit-logs', () => {
  it('returns all org rows (un-scoped) with `site` field populated from JOIN', async () => {
    const { db } = makeMockDb([
      {
        id: 'r1',
        action: 'site.created',
        target_type: 'site',
        target_id: SITE_ID,
        actor_id: 'user-1',
        metadata_json: '{"slug":"vitos-mens-salon"}',
        request_id: 'req-1',
        created_at: '2026-05-21T12:00:00.000Z',
        site_slug: SITE_SLUG,
      },
      {
        id: 'r2',
        action: 'billing.checkout_created',
        target_type: 'org',
        target_id: ORG_ID,
        actor_id: 'user-1',
        metadata_json: null,
        request_id: 'req-2',
        created_at: '2026-05-21T11:00:00.000Z',
        site_slug: null,
      },
    ]);
    const { app, env } = createAuthedApp(db);
    const res = await app.request('/api/audit-logs', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; site: string | null }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toEqual(expect.objectContaining({ id: 'r1', site: SITE_SLUG }));
    expect(body.data[1]).toEqual(expect.objectContaining({ id: 'r2', site: null }));
  });

  it('caps `limit` at 500 even when caller requests more', async () => {
    const { db, captured } = makeMockDb([]);
    const { app, env } = createAuthedApp(db);
    await app.request('/api/audit-logs?limit=9999', {}, env);
    // limit + offset are the last two bound params in the un-scoped query
    const limitParam = captured.params[captured.params.length - 2];
    expect(limitParam).toBe(500);
  });

  it('floors `limit` at 1 for negative / zero values', async () => {
    const { db, captured } = makeMockDb([]);
    const { app, env } = createAuthedApp(db);
    await app.request('/api/audit-logs?limit=-5', {}, env);
    const limitParam = captured.params[captured.params.length - 2];
    expect(limitParam).toBe(1);
  });

  it('scopes by `site_slug` — resolves slug → id (org-scoped) then narrows SQL', async () => {
    mockDbQueryOne
      .mockResolvedValueOnce({ id: SITE_ID }) // slug → id lookup
      .mockResolvedValueOnce({ slug: SITE_SLUG }); // id → slug stamp
    const { db, captured } = makeMockDb([
      {
        id: 'r1',
        action: 'hostname.provisioned',
        target_type: 'hostname',
        target_id: 'hostname-xyz',
        actor_id: 'user-1',
        // metadata-only linkage to the site — covered by the LIKE fallback
        metadata_json: `{"site_id":"${SITE_ID}"}`,
        request_id: 'req-1',
        created_at: '2026-05-21T12:00:00.000Z',
        site_slug: null,
      },
    ]);
    const { app, env } = createAuthedApp(db);
    const res = await app.request(`/api/audit-logs?site_slug=${SITE_SLUG}`, {}, env);
    expect(res.status).toBe(200);
    expect(captured.sql).toContain('a.target_id = ? OR a.metadata_json LIKE ?');
    expect(captured.params).toEqual(
      expect.arrayContaining([ORG_ID, SITE_ID, `%"site_id":"${SITE_ID}"%`]),
    );
    const body = (await res.json()) as { data: Array<{ id: string; site: string | null }> };
    // `site` filled from the scoped-slug stamp since the JOIN didn't fire
    expect(body.data[0]).toEqual(expect.objectContaining({ id: 'r1', site: SITE_SLUG }));
  });

  it('returns empty data when `site_slug` does not resolve to a site in the org', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null); // slug → id miss
    const { db } = makeMockDb([]);
    const { app, env } = createAuthedApp(db);
    const res = await app.request('/api/audit-logs?site_slug=ghost-slug', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('honors `site_id` directly (skips slug lookup) and narrows SQL', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ slug: SITE_SLUG }); // id → slug stamp
    const { db, captured } = makeMockDb([
      {
        id: 'r1',
        action: 'site.deployed',
        target_type: 'site',
        target_id: SITE_ID,
        actor_id: 'user-1',
        metadata_json: null,
        request_id: 'req-1',
        created_at: '2026-05-21T12:00:00.000Z',
        site_slug: SITE_SLUG,
      },
    ]);
    const { app, env } = createAuthedApp(db);
    const res = await app.request(`/api/audit-logs?site_id=${SITE_ID}`, {}, env);
    expect(res.status).toBe(200);
    expect(captured.params).toEqual(
      expect.arrayContaining([ORG_ID, SITE_ID, `%"site_id":"${SITE_ID}"%`]),
    );
    const body = (await res.json()) as { data: Array<{ id: string; site: string | null }> };
    expect(body.data[0]).toEqual(expect.objectContaining({ id: 'r1', site: SITE_SLUG }));
  });

  it('parses `metadata_json` into an object on the response row', async () => {
    const { db } = makeMockDb([
      {
        id: 'r1',
        action: 'site.updated',
        target_type: 'site',
        target_id: SITE_ID,
        actor_id: 'user-1',
        metadata_json: '{"field":"business_name","old":"A","new":"B"}',
        request_id: 'req-1',
        created_at: '2026-05-21T12:00:00.000Z',
        site_slug: SITE_SLUG,
      },
    ]);
    const { app, env } = createAuthedApp(db);
    const res = await app.request('/api/audit-logs', {}, env);
    const body = (await res.json()) as {
      data: Array<{ metadata: Record<string, unknown> | null }>;
    };
    expect(body.data[0].metadata).toEqual({ field: 'business_name', old: 'A', new: 'B' });
  });

  it('returns 401 when caller has no orgId', async () => {
    const { db } = makeMockDb([]);
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.onError(errorHandler);
    app.route('/', api);
    const env = { ENVIRONMENT: 'test', DB: db } as unknown as Env;
    const res = await app.request('/api/audit-logs', {}, env);
    expect(res.status).toBe(401);
  });
});
