/**
 * @module __tests__/ai-search
 * @description Tests for `POST /api/admin/search/ai` (item #94).
 *
 * Verifies that:
 *  1. Auth is required.
 *  2. The LLM filter is translated into a parameterised D1 SELECT — no
 *     user-supplied string is interpolated into the SQL.
 *  3. Every entity branch (audit/forms/traces/sites/users) WHERE-scopes
 *     by org_id.
 *  4. Pure helper `buildSearchSql` round-trips a filter into the exact
 *     parameter list a route would bind.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn(),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));
jest.mock('../lib/sentry.js', () => ({ captureError: jest.fn(), captureMessage: jest.fn(), createSentry: jest.fn() }));
jest.mock('../lib/posthog.js', () => ({ capture: jest.fn(), trackAuth: jest.fn(), trackSite: jest.fn(), trackError: jest.fn() }));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { aiAdmin } from '../routes/ai_admin.js';
import { buildSearchSql } from '../services/ai_admin_features.js';

const ORG_ID = 'org-search-1';

function makeDb(rows: Record<string, unknown>[]): {
  db: D1Database;
  captured: { sql: string; params: unknown[] };
} {
  const captured = { sql: '', params: [] as unknown[] };
  const db = {
    prepare: jest.fn((sql: string) => {
      captured.sql = sql;
      return {
        bind: jest.fn((...p: unknown[]) => {
          captured.params = p;
          return {
            all: jest.fn().mockResolvedValue({ results: rows, success: true }),
            first: jest.fn().mockResolvedValue(rows[0] ?? null),
          };
        }),
      };
    }),
  } as unknown as D1Database;
  return { db, captured };
}

function makeEnv(aiResponse: string, db: D1Database): Env {
  return {
    DB: db,
    CACHE_KV: { get: jest.fn(), put: jest.fn(), delete: jest.fn() },
    AI: { run: jest.fn().mockResolvedValue({ response: aiResponse }) } as unknown as Ai,
    ENVIRONMENT: 'test',
  } as unknown as Env;
}

function authedApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('orgId', ORG_ID);
    c.set('userId', 'user-1');
    c.set('requestId', 'req-1');
    await next();
  });
  app.route('/', aiAdmin);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/admin/search/ai', () => {
  it('rejects unauthenticated requests', async () => {
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.onError(errorHandler);
    app.route('/', aiAdmin);
    const { db } = makeDb([]);
    const env = makeEnv('{}', db);
    const res = await app.request(
      '/api/admin/search/ai',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'errors today' }),
      },
      env,
    );
    expect(res.status).toBe(401);
  });

  it('translates an NL query into a parameterised audit_logs SELECT scoped by org_id', async () => {
    const { db, captured } = makeDb([
      { id: 'a1', action: 'site.created', target_type: 'site', created_at: '2026-05-21T10:00:00Z' },
    ]);
    const llm = JSON.stringify({
      entity: 'audit',
      filters: { action: 'site.created' },
      limit: 50,
    });
    const env = makeEnv(llm, db);
    const res = await authedApp().request(
      '/api/admin/search/ai',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'show me site creation audit events' }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { entity: string; rows: unknown[]; llm_filters: { entity: string } };
    };
    expect(body.data.entity).toBe('audit');
    expect(body.data.rows).toHaveLength(1);
    expect(body.data.llm_filters.entity).toBe('audit');

    // SQL was parameterised — no LIKE injection, no string interpolation of
    // the user query, and the org_id WAS the first bound param.
    expect(captured.sql).toContain('FROM audit_logs');
    expect(captured.sql).toContain('WHERE org_id = ?');
    expect(captured.sql).toMatch(/action = \?/);
    expect(captured.sql).not.toContain("'site.created'"); // never interpolated
    expect(captured.params[0]).toBe(ORG_ID);
    expect(captured.params).toContain('site.created');
  });

  it('rejects an LLM response with an unknown entity (502)', async () => {
    const { db } = makeDb([]);
    const env = makeEnv(JSON.stringify({ entity: 'unknown-table' }), db);
    const res = await authedApp().request(
      '/api/admin/search/ai',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'something' }),
      },
      env,
    );
    expect(res.status).toBe(502);
  });
});

describe('buildSearchSql', () => {
  it('always binds org_id first for traces', () => {
    const plan = buildSearchSql(
      { entity: 'traces', filters: { status: 'error', endpoint_slug: 'lead-qualifier' }, limit: 25 },
      ORG_ID,
    );
    expect(plan.entity).toBe('traces');
    expect(plan.sql).toContain('FROM ai_form_logs');
    expect(plan.sql).toContain('WHERE org_id = ?');
    expect(plan.params[0]).toBe(ORG_ID);
    expect(plan.params).toContain('error');
    expect(plan.params).toContain('lead-qualifier');
    expect(plan.params[plan.params.length - 1]).toBe(25);
  });

  it('drops unknown filter columns silently (no SQL injection vector)', () => {
    const plan = buildSearchSql(
      { entity: 'audit', filters: { action: 'site.created', evil: "1' OR 1=1; --" } as Record<string, string> },
      ORG_ID,
    );
    expect(plan.sql).toContain('action = ?');
    expect(plan.sql).not.toContain('evil');
    expect(plan.params).not.toContain("1' OR 1=1; --");
  });

  it('uses a JOIN for users entity and scopes by membership org_id', () => {
    const plan = buildSearchSql({ entity: 'users', filters: { email: '%@example.com' } }, ORG_ID);
    expect(plan.sql).toContain('FROM users u JOIN memberships m');
    expect(plan.sql).toContain('m.org_id = ?');
    expect(plan.sql).toMatch(/u\.email LIKE \?/);
    expect(plan.params[0]).toBe(ORG_ID);
  });

  it('clamps limit between 1 and 100', () => {
    const big = buildSearchSql({ entity: 'sites', limit: 9999 }, ORG_ID);
    expect(big.params[big.params.length - 1]).toBe(100);
    const tiny = buildSearchSql({ entity: 'sites', limit: 0 }, ORG_ID);
    expect(tiny.params[tiny.params.length - 1]).toBe(1);
  });
});
