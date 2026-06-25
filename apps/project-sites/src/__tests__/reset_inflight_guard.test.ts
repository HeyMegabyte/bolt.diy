/**
 * POST /api/sites/:id/reset MUST refuse to kick a SECOND build while one is
 * already in flight (#35 follow-on — build-concurrency abuse).
 *
 * `/reset` rebuilds an already-owned site, so the site-count quota correctly
 * doesn't block it — but it unconditionally set status='building' and kicked a
 * $5-15 SITE_WORKFLOW build with NO check on the current status. Hammering
 * `/reset` therefore spawned N concurrent builds on the same site. This proves
 * the in-flight guard now fires: a site already `building`/`generating` gets a
 * 409 CONFLICT and the workflow is never created again.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { api } from '../routes/api.js';
import { errorHandler } from '../middleware/error_handler.js';

/** D1 stub: the requireOwnedSite SELECT returns a site with the given status. */
function makeDbStub(status: string) {
  const writes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            all: async () => {
              if (/FROM sites WHERE id = \? AND org_id = \?/i.test(sql)) {
                return {
                  results: [
                    {
                      id: 'site-1',
                      slug: 'acme',
                      org_id: 'org-1',
                      business_name: 'Acme',
                      business_address: null,
                      google_place_id: null,
                      budget_tier: 'free',
                      status,
                    },
                  ],
                };
              }
              return { results: [] };
            },
            run: async () => {
              if (/UPDATE sites SET/i.test(sql)) writes.push(sql);
              return { meta: { changes: 1 } };
            },
            first: async () => null,
          };
        },
      };
    },
  };
  return { db: db as unknown as Env['DB'], writes };
}

function makeApp(env: Partial<Env>) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('orgId', 'org-1');
    c.set('userId', 'user-1');
    c.set('requestId', 'test-req');
    await next();
  });
  app.route('/', api);
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  return () =>
    app.request(
      '/api/sites/site-1/reset',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env as Env,
      ctx,
    );
}

describe('POST /api/sites/:id/reset — in-flight build guard (#35 follow-on)', () => {
  it.each(['building', 'generating'])(
    'returns 409 CONFLICT when the site is already %s, and never re-creates the workflow',
    async (status) => {
      const { db, writes } = makeDbStub(status);
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
      const res = await makeApp(env)();
      expect(res.status).toBe(409);
      expect((await res.json()).error.code).toBe('CONFLICT');
      expect(workflowCreated).toBe(0); // no duplicate $5-15 build
      expect(writes).toHaveLength(0); // status not re-stamped to 'building'
    },
  );

  it('still allows a reset when the site is in a terminal state (published)', async () => {
    const { db } = makeDbStub('published');
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
    const res = await makeApp(env)();
    expect(res.status).toBe(200);
    expect(workflowCreated).toBe(1);
  });
});
