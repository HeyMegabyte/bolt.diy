/**
 * GET /api/billing/quota — owner-facing site-quota snapshot (#35 UI data layer).
 *
 * Surfaces the SAME checkBuildLimit the create paths enforce, so the "X of Y
 * sites" the owner sees equals the number the server gates on. Verifies the
 * over-quota and under-quota shapes + the 401 auth gate.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { api } from '../routes/api.js';
import { errorHandler } from '../middleware/error_handler.js';

function makeDbStub(siteCount: number) {
  const db = {
    prepare(sql: string) {
      return {
        bind(..._params: unknown[]) {
          return {
            all: async () => {
              if (/FROM subscriptions/i.test(sql)) return { results: [] }; // free
              if (/FROM users u JOIN memberships/i.test(sql)) return { results: [] };
              if (/COUNT\(\*\) as count FROM sites/i.test(sql))
                return { results: [{ count: siteCount }] };
              return { results: [] };
            },
            first: async () => null,
          };
        },
      };
    },
  };
  return db as unknown as Env['DB'];
}

function makeApp(env: Partial<Env>, authed = true) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (authed) c.set('orgId', 'org-1');
    c.set('requestId', 'test-req');
    await next();
  });
  app.route('/', api);
  return () => app.request('/api/billing/quota', {}, env as Env);
}

describe('GET /api/billing/quota (#35)', () => {
  it('requires authentication', async () => {
    const res = await makeApp({ DB: makeDbStub(0) }, false)();
    expect(res.status).toBe(401);
  });

  it('reports an over-quota free org as not allowed (1/1, 0 remaining)', async () => {
    const res = await makeApp({ DB: makeDbStub(1) })();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      used: 1,
      limit: 1,
      remaining: 0,
      allowed: false,
      plan: 'free',
      unlimited: false,
    });
  });

  it('reports an under-quota free org as allowed (0/1, 1 remaining)', async () => {
    const res = await makeApp({ DB: makeDbStub(0) })();
    const { data } = await res.json();
    expect(data).toMatchObject({
      used: 0,
      limit: 1,
      remaining: 1,
      allowed: true,
      unlimited: false,
    });
  });
});
