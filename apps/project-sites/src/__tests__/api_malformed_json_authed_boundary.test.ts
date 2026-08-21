/**
 * Input-boundary coverage for the AUTHED-admin POST handlers in `routes/api.ts`
 * that read the body with a bare `await c.req.json()` AND immediately
 * `SomeSchema.parse(...)` it — so a malformed JSON body throws an uncaught
 * SyntaxError at the parse → 500 instead of a clean 400.
 *
 * Only the handlers that IMMEDIATELY validate are covered here (so `.catch(() =>
 * ({}))` provably lands a malformed body on the existing required-field
 * ZodError→400 path, never a silent `{}` no-op):
 *   - POST /api/sites                         → createSiteSchema.parse(body)
 *   - POST /api/sites/:siteId/hostnames       → createHostnameSchema.parse({...body, site_id})
 *   - POST /api/domains/suggest/refine        → suggestRefineSchema.parse(body)
 *   - POST /api/billing/spend-alerts          → createSpendAlertSchema.parse(body)
 *
 * Deliberately EXCLUDED (would need a different fix, not a blind `.catch`):
 * `/api/publish/bolt` + `/api/sites/:id/publish-bolt` (destructure w/o parse —
 * `{}` silently no-ops), `/api/validate-business` (defensive field reads —
 * `{}`→valid:false changes semantics), `/api/feedback` (already in its own
 * try/catch). Same per-handler discipline as `api_malformed_json_boundary`.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { domains } from '../../libs/features/domains/handlers.js';

const mockDb = {
  prepare: jest.fn(() => ({
    bind: jest.fn(() => ({
      first: jest.fn().mockResolvedValue(null),
      all: jest.fn().mockResolvedValue({ results: [] }),
      run: jest.fn().mockResolvedValue({}),
    })),
  })),
} as unknown as D1Database;

function makeEnv(): Env {
  return { ENVIRONMENT: 'test', DB: mockDb } as unknown as Env;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.use('*', async (c, next) => {
  c.set('orgId', 'org-1');
  c.set('userId', 'user-1');
  c.set('requestId', 'req-1');
  await next();
});
app.route('/', domains);
app.route('/', api);

function postRaw(path: string, raw: string) {
  return app.request(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw },
    makeEnv(),
  );
}

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

describe('routes/api.ts (authed) — malformed JSON body → 4xx (not 500)', () => {
  const endpoints = [
    '/api/sites',
    '/api/sites/site-1/hostnames',
    '/api/domains/suggest/refine',
    '/api/billing/spend-alerts',
  ];

  it.each(endpoints)('POST %s with a malformed body returns a 4xx, never a 500', async (path) => {
    const res = await postRaw(path, '{ not : valid json');
    expect(res.status).not.toBe(500);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
