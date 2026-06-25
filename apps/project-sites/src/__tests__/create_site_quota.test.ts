/**
 * POST /api/sites (manual create) MUST enforce the per-tenant site quota (#35).
 *
 * It creates a `sites` row via the shared createSite core but did NOT call
 * checkBuildLimit — so a free org (1-site cap) could POST /api/sites N times to
 * accumulate sites, then /reset each into a build, bypassing the limit that
 * create-from-search + import-from-url enforce. This proves the gate now fires:
 * an over-quota org gets 403 BUILD_LIMIT_REACHED and no site row is inserted.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { api } from '../routes/api.js';
import { errorHandler } from '../middleware/error_handler.js';

function makeDbStub(siteCount: number) {
  const inserts: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            all: async () => {
              if (/FROM subscriptions/i.test(sql)) return { results: [] };
              if (/FROM users u JOIN memberships/i.test(sql)) return { results: [] };
              if (/COUNT\(\*\) as count FROM sites/i.test(sql)) return { results: [{ count: siteCount }] };
              return { results: [] };
            },
            run: async () => {
              if (/^INSERT INTO sites/i.test(sql.trim())) inserts.push(sql);
              return { meta: { changes: 1 } };
            },
            first: async () => null,
          };
        },
      };
    },
  };
  return { db: db as unknown as Env['DB'], inserts };
}

function makeApp(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('orgId', 'org-free-1');
    c.set('userId', 'user-1');
    c.set('requestId', 'test-req');
    await next();
  });
  app.route('/', api);
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  return (body: unknown) =>
    app.request(
      '/api/sites',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      env as Env,
      ctx,
    );
}

describe('POST /api/sites — build-quota enforcement (#35)', () => {
  it('rejects an over-quota free org with 403 BUILD_LIMIT_REACHED and inserts no site', async () => {
    const { db, inserts } = makeDbStub(1); // free limit 1, already 1 → over quota
    const res = await makeApp({ DB: db })({ business_name: 'Acme Co', slug: 'acme-co' });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('BUILD_LIMIT_REACHED');
    expect(inserts).toHaveLength(0);
  });
});
