/**
 * #32 — dark-launched Turnstile bot-gate on POST /api/sites/create-from-search.
 *
 * When the `turnstile_build_gate` flag is ON and the secret is configured, a
 * missing/invalid token is rejected 403 BEFORE a paid build is kicked. The flag
 * defaults OFF and the gate soft-allows when the secret is unset, so neither the
 * default nor a premature flag-flip can break the live create funnel — both of
 * those paths are covered by the existing create-from-search tests (flag off).
 */
jest.mock('../services/db.js', () => ({
  // checkBuildLimit: owner-email join → null; COUNT(sites) → 0 (under quota → allowed).
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbQuery: jest.fn().mockResolvedValue({ data: [{ count: 0 }], error: null }),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbExecute: jest.fn().mockResolvedValue({ error: null }),
}));
jest.mock('../services/audit.js', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true), // flag ON
}));
jest.mock('../services/turnstile.js', () => ({
  verifyTurnstileToken: jest.fn().mockResolvedValue({ ok: false, reason: 'missing_token' }),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { search } from '../routes/search.js';

function authedApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('orgId', 'org-1');
    c.set('userId', 'user-1');
    c.set('requestId', 'test-req');
    await next();
  });
  app.route('/', search);
  const env = { TURNSTILE_SECRET_KEY: 'secret-set' } as unknown as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  return (body: unknown) =>
    app.request(
      '/api/sites/create-from-search',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
      env,
      ctx,
    );
}

describe('create-from-search Turnstile gate (#32, flag ON + secret set)', () => {
  it('rejects a missing/invalid token with 403 TURNSTILE_REQUIRED before building', async () => {
    const res = await authedApp()({ business: { name: 'Acme' } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('TURNSTILE_REQUIRED');
  });
});
