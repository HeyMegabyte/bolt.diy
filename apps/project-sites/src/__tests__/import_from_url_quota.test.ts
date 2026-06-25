/**
 * POST /api/sites/import-from-url MUST enforce the per-tenant build quota
 * BEFORE crawling + creating a new site (#35 — quota-bypass hole).
 *
 * The route creates a brand-new `sites` row and kicks a $5-15 SITE_WORKFLOW
 * build. `create-from-search` already gates on `checkBuildLimit`; this route
 * did NOT — so a free-tier org (capped at 1 site) could spin up unlimited
 * sites + builds through the importer. This proves the gate now fires:
 *  - an over-quota org gets 403 BUILD_LIMIT_REACHED,
 *  - NO site row is inserted,
 *  - the workflow is NEVER created (no spend),
 *  - and the crawl never runs (the gate precedes the fetch).
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { api } from '../routes/api.js';
import { errorHandler } from '../middleware/error_handler.js';

/** SQL-routing D1 stub: returns the right rows per query checkBuildLimit + the route run. */
function makeDbStub(siteCount: number) {
  const inserts: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            all: async () => {
              if (/FROM subscriptions/i.test(sql)) return { results: [] }; // no active sub → free
              if (/FROM users u JOIN memberships/i.test(sql)) return { results: [] }; // not the unlimited owner
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
      '/api/sites/import-from-url',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
      env as Env,
      ctx,
    );
}

describe('POST /api/sites/import-from-url — build-quota enforcement (#35)', () => {
  const realFetch = global.fetch;
  let fetchCalls = 0;
  beforeEach(() => {
    fetchCalls = 0;
    global.fetch = (async () => {
      fetchCalls += 1;
      return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('rejects an over-quota free org with 403 BUILD_LIMIT_REACHED, never inserts, never crawls', async () => {
    // Free limit is 1 site; this org already has 1 → over quota.
    const { db, inserts } = makeDbStub(1);
    let workflowCreated = 0;
    const env: Partial<Env> = {
      DB: db,
      SITE_WORKFLOW: {
        create: async () => {
          workflowCreated += 1;
          return { id: 'wf-1' };
        },
      } as unknown as Env['SITE_WORKFLOW'],
    };
    const res = await makeApp(env)({ url: 'https://example.com' });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('BUILD_LIMIT_REACHED');
    expect(workflowCreated).toBe(0); // no $5-15 build kicked
    expect(inserts).toHaveLength(0); // no new site row
    expect(fetchCalls).toBe(0); // gate precedes the crawl — no network spend either
  });
});
