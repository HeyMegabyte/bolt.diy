/**
 * @module __tests__/templates
 * @description Route-layer tests for the templates marketplace
 * (`/api/templates`, `/api/templates/:slug`, `/api/sites/:siteId/install-template`).
 * Locks the fire-35 fix: installing a template onto a missing/foreign-org site
 * now returns **404 (never 403)** — a foreign site id is indistinguishable from
 * a missing one (existence oracle closed). `db.js` + `pro.js` are mocked; the
 * real `errorHandler` maps thrown AppErrors to HTTP status.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
}));

jest.mock('../services/pro.js', () => ({
  requirePro: async (_c: unknown, next: () => Promise<void>) => {
    await next();
  },
}));

import { Hono } from 'hono';
import { dbQuery, dbQueryOne, dbInsert } from '../services/db.js';
import { templates } from '../routes/templates.js';
import { errorHandler } from '../middleware/error_handler.js';
import type { Env, Variables } from '../types/env.js';

const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;

/** D1 double — install-template runs a raw `prepare(UPDATE).bind().run()` for the install_count bump. */
function baseDb(sink?: string[]) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        run: async () => {
          sink?.push(sql);
          return { meta: {} };
        },
      }),
    }),
  } as unknown as Env['DB'];
}

function app(ids?: { userId?: string; orgId?: string }, sink?: string[]) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use('*', async (c, next) => {
    if (ids?.userId) c.set('userId', ids.userId);
    if (ids?.orgId) c.set('orgId', ids.orgId);
    c.set('requestId', 'test-req');
    await next();
  });
  a.onError(errorHandler);
  a.route('/', templates);
  const env = { DB: baseDb(sink) } as unknown as Env;
  const ctx = {
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  } as unknown as ExecutionContext;
  const request = (path: string, init?: RequestInit) => a.request(path, init, env, ctx);
  return { request };
}

const json = { 'content-type': 'application/json' };
const INSTALL = '/api/sites/s1/install-template';
const freeBody = JSON.stringify({ template_slug: 'modern' });

beforeEach(() => {
  jest.resetAllMocks();
  mockQuery.mockResolvedValue({ data: [], error: null });
  mockQueryOne.mockResolvedValue(null);
  mockInsert.mockResolvedValue({ error: null });
});

// ─── GET catalog (anonymous) ──────────────────────────────────────────
describe('GET /api/templates (public catalog)', () => {
  it('200 lists templates without auth', async () => {
    mockQuery.mockResolvedValueOnce({ data: [{ id: 't1', slug: 'modern' }], error: null });
    const { request } = app();
    const res = await request('/api/templates');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { templates: unknown[] }).templates).toHaveLength(1);
  });

  it('GET /:slug → 404 for an unknown slug', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const { request } = app();
    expect((await request('/api/templates/ghost')).status).toBe(404);
  });

  it('GET /:slug → 200 with version history for a known slug', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 't1', slug: 'modern' } as never); // template
    mockQuery.mockResolvedValueOnce({ data: [{ id: 'v1', version: '1.0' }], error: null }); // versions
    const { request } = app();
    const res = await request('/api/templates/modern');
    expect(res.status).toBe(200);
    const out = (await res.json()) as { versions: unknown[] };
    expect(out.versions).toHaveLength(1);
  });
});

// ─── POST install-template (the fire-35 403→404 fix) ──────────────────
describe('POST /api/sites/:siteId/install-template (404 never 403)', () => {
  it('401 when unauthenticated', async () => {
    const { request } = app();
    expect((await request(INSTALL, { method: 'POST', headers: json, body: freeBody })).status).toBe(
      401,
    );
  });

  it('400 on an invalid body (missing template_slug)', async () => {
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request(INSTALL, { method: 'POST', headers: json, body: '{}' })).status).toBe(
      400,
    );
  });

  it('404 (NOT 403) installing onto a foreign-org site — no insert, no count bump', async () => {
    mockQueryOne.mockResolvedValueOnce({ org_id: 'OTHER_ORG' } as never); // site lookup
    const sink: string[] = [];
    const { request } = app({ userId: 'u', orgId: 'org-a' }, sink);
    const res = await request(INSTALL, { method: 'POST', headers: json, body: freeBody });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    expect(mockInsert).not.toHaveBeenCalled(); // template never installed onto a foreign site
    expect(sink).toHaveLength(0); // install_count never bumped
  });

  it('404 installing onto a non-existent site', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // site missing
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request(INSTALL, { method: 'POST', headers: json, body: freeBody })).status).toBe(
      404,
    );
  });

  it('404 when the template slug does not exist', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ org_id: 'org-a' } as never) // owned site
      .mockResolvedValueOnce(null); // template missing
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    expect((await request(INSTALL, { method: 'POST', headers: json, body: freeBody })).status).toBe(
      404,
    );
  });

  it('402 installing a paid template without Pro', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ org_id: 'org-a' } as never) // owned site
      .mockResolvedValueOnce({ id: 't1', price_cents: 500 } as never) // paid template
      .mockResolvedValueOnce({ is_pro: 0 } as never); // non-pro user
    const { request } = app({ userId: 'u', orgId: 'org-a' });
    const res = await request(INSTALL, { method: 'POST', headers: json, body: freeBody });
    expect(res.status).toBe(402);
  });

  it('200 installs a free template into an org-owned site (insert + count bump)', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ org_id: 'org-a' } as never) // owned site
      .mockResolvedValueOnce({ id: 't1', price_cents: 0 } as never); // free template
    const sink: string[] = [];
    const { request } = app({ userId: 'u', orgId: 'org-a' }, sink);
    const res = await request(INSTALL, { method: 'POST', headers: json, body: freeBody });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { install_id: string; template_id: string };
    expect(out.template_id).toBe('t1');
    expect(mockInsert).toHaveBeenCalledTimes(1); // template_installs row
    expect(sink.some((s) => /UPDATE templates SET install_count/.test(s))).toBe(true);
  });
});
