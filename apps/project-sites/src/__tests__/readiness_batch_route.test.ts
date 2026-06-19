/**
 * GET /api/readiness?ids=… — batch Production-Readiness grades (backlog #9
 * follow-on). Replaces N per-row badge fetches with one request.
 *
 * Verifies: every requested id is present in the map (unscored → null),
 * org-scoping falls out of the audit_logs.org_id filter (an unowned id returns
 * null), empty input → empty map, and unauthenticated → 401.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { api } from '../routes/api.js';
import { errorHandler } from '../middleware/error_handler.js';

interface AuditRow {
  target_id: string;
  metadata_json: string | null;
  created_at: string;
}

/** Minimal D1 stub: prepare().bind().all() → { results }. Captures bind params. */
function makeDbStub(rows: AuditRow[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return { all: async () => ({ results: rows }) };
        },
      };
    },
  };
  return { db: db as unknown as Env['DB'], calls };
}

function makeApp(vars: Partial<Variables>, env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.orgId) c.set('orgId', vars.orgId);
    c.set('requestId', vars.requestId ?? 'test-req');
    await next();
  });
  app.route('/', api);
  return (path: string) => app.request(path, {}, env as Env);
}

const READY_META = JSON.stringify({
  readiness_grade: 'A',
  readiness_score: 96,
  readiness_passing: true,
  summary: 'Ready to publish.',
});

describe('GET /api/readiness (batch readiness)', () => {
  it('requires authentication', async () => {
    const { db } = makeDbStub([]);
    const req = makeApp({}, { DB: db });
    const res = await req('/api/readiness?ids=s1');
    expect(res.status).toBe(401);
  });

  it('returns an empty map for no ids', async () => {
    const { db } = makeDbStub([]);
    const req = makeApp({ orgId: 'org-1' }, { DB: db });
    const res = await req('/api/readiness');
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({});
  });

  it('maps each requested id; scored→data, unscored/unowned→null', async () => {
    // s1 has a scored build; s2 has an audit row without a readiness_grade;
    // s3 is not in the org's audit rows at all (unowned / never built).
    const rows: AuditRow[] = [
      { target_id: 's1', metadata_json: READY_META, created_at: '2026-06-19T00:00:00Z' },
      { target_id: 's2', metadata_json: JSON.stringify({ other: 1 }), created_at: '2026-06-18T00:00:00Z' },
    ];
    const { db, calls } = makeDbStub(rows);
    const req = makeApp({ orgId: 'org-1' }, { DB: db });
    const res = await req('/api/readiness?ids=s1,s2,s3');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };

    expect(Object.keys(data).sort()).toEqual(['s1', 's2', 's3']);
    expect(data['s1']).toEqual(expect.objectContaining({ grade: 'A', score: 96 }));
    expect(data['s2']).toBeNull();
    expect(data['s3']).toBeNull();

    // Org-scoping: the query is filtered by org_id + the requested ids.
    expect(calls[0].params[0]).toBe('org-1');
    expect(calls[0].params).toContain('s1');
    expect(calls[0].params).toContain('s3');
  });

  it('caps the id list at 100', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `s${i}`);
    const { db, calls } = makeDbStub([]);
    const req = makeApp({ orgId: 'org-1' }, { DB: db });
    const res = await req(`/api/readiness?ids=${ids.join(',')}`);
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(Object.keys(data).length).toBe(100);
    // org_id + 100 ids = 101 bind params.
    expect(calls[0].params.length).toBe(101);
  });
});
