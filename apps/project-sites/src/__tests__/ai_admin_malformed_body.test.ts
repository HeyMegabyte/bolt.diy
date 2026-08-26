/**
 * Reliability boundary: a malformed JSON body must never be a 5xx. These
 * `ai_admin.ts` handlers read the body with a bare `(await c.req.json()) as ...`
 * cast — on a malformed body `c.req.json()` throws a SyntaxError, and ai_admin's
 * own `onError` maps anything that isn't an `HTTPError` to 500 (server fault +
 * noise). Fix: `.catch(() => ({}))` so a malformed body collapses to `{}` and
 * is handled as an empty body (each handler's own semantics: slug/bundle/folder
 * guards → 400; graceful settings/endpoint updates → 200) — never a 5xx.
 *
 * (fire-19: closes the ai_admin.ts half of the no-catch class. The body read is
 * AFTER `siteOwned()`, so the DB mock returns an owned site + endpoint row.)
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { aiAdmin } from '../routes/ai_admin.js';
// Route-decomposition installment 14: POST /api/billing/credits/topup moved to the
// `billing` module. Mount it BEFORE `aiAdmin` (mirrors src/index.ts) so the malformed-
// body path exercises the real moved handler, not a 404.
import { billing } from '../../libs/features/billing/handlers.js';
// Route-decomposition installment 15: POST/PUT /api/sites/:siteId/ai-endpoints[/*] moved to
// the `aiEndpoints` module. Mount it BEFORE `aiAdmin` (mirrors src/index.ts) so the
// malformed-body path exercises the real moved handlers, not a 404.
import { aiEndpoints } from '../../libs/features/ai_endpoints/handlers.js';

const mockDb = {
  prepare: jest.fn((sql: string) => {
    const isSites = /FROM sites/i.test(sql);
    const isEndpoints = /FROM ai_endpoints/i.test(sql);
    const row = isSites
      ? { slug: 'nsk', business_name: 'NSK' }
      : isEndpoints
        ? {
            id: 'ep-1',
            endpoint_slug: 'hello',
            kind: 'prompt',
            wfp_script_name: null,
            language: null,
          }
        : null;
    return {
      bind: jest.fn(() => ({
        first: jest.fn().mockResolvedValue(row),
        all: jest.fn().mockResolvedValue({ results: row ? [row] : [] }),
        run: jest.fn().mockResolvedValue({}),
      })),
    };
  }),
} as unknown as D1Database;

const env = { ENVIRONMENT: 'test', DB: mockDb } as unknown as Env;

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', async (c, next) => {
  c.set('orgId', 'org-1');
  c.set('userId', 'user-1');
  c.set('requestId', 'req-1');
  await next();
});
// billing owns the moved /api/billing/credits/topup route; mount it ahead of aiAdmin.
app.route('/', billing);
// aiEndpoints owns the moved /api/sites/:siteId/ai-endpoints[/*] routes; mount ahead of aiAdmin.
app.route('/', aiEndpoints);
app.route('/', aiAdmin);

// Some handlers schedule the audit write via `c.executionCtx.waitUntil(...)`,
// which is undefined in jest — supply a stub so we exercise the malformed-body
// path, not the missing-runtime-ctx path.
const execCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function send(method: string, path: string) {
  return app.request(
    path,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: 'this-is-not-json',
    },
    env,
    execCtx,
  );
}

describe('malformed JSON body is never a 5xx on no-catch ai_admin.ts handlers', () => {
  it.each([
    ['PUT', '/api/sites/site-1/ai-settings'],
    ['POST', '/api/sites/site-1/ai-endpoints'],
    ['PUT', '/api/sites/site-1/ai-endpoints/ep-1'],
    ['POST', '/api/billing/credits/topup'],
    ['POST', '/api/sites/site-1/ai/drive/select-folder'],
  ])('handles a malformed body to %s %s without a 5xx', async (method, path) => {
    const res = await send(method as string, path as string);
    expect(res.status).toBeLessThan(500);
  });
});
