/**
 * Route contract for `apiTokensAdmin` (`/api/v1-tokens`) — the account-level
 * Public API token CRUD behind the `/admin/api-tokens` UI.
 *
 * REGRESSION GUARD (2026-08-16): migration `0614_unflag_and_remove_flags.sql`
 * UN-FLAGGED `public_api` ("feature kept, gate dropped … features are now
 * unconditional") and removed the `isFlagOn` checks from the sibling routes
 * (logs.ts, copilot.ts, domain_stack.ts) — but MISSED api_tokens_admin.ts, which
 * kept `if (!isFlagOn(env,'public_api',…)) return 404` on all three handlers.
 * Because `public_api` is no longer a resolvable flag, `isFlagOn` returned false
 * → GET/POST/DELETE /api/v1-tokens 404'd for EVERY authenticated org → the whole
 * API Tokens feature was dead (the UI showed a misleading "not enabled" gate).
 *
 * These tests mock `isFlagOn` to return FALSE and assert the handlers still work
 * (200 / 401 / validation) — i.e. the endpoint is unconditional and can never be
 * re-gated on a dead flag without failing this spec.
 *
 * ts-jest/@swc-jest: use the GLOBAL `jest` (no `@jest/globals` import) so
 * `jest.mock` hoists above the route import.
 */
import { Hono } from 'hono';

// Simulate the post-0614 reality: `public_api` is not a resolvable flag → OFF.
jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(async () => false),
}));
// Isolate from D1 — the route delegates persistence to these service fns.
jest.mock('../services/api_tokens.js', () => ({
  listApiTokens: jest.fn(async () => []),
  createApiToken: jest.fn(async () => ({
    token: { id: 't1', name: 'CI', scopes: ['sites:read'], created_at: 'now' },
    plaintext: 'psk_deadbeef',
  })),
  revokeApiToken: jest.fn(async () => true),
  VALID_SCOPES: ['sites:read', 'sites:write', 'me:read'] as const,
}));

import { apiTokensAdmin } from '../routes/api_tokens_admin.js';

const env = { DB: {} } as never;

/** Mount the sub-app behind a middleware that injects the auth context the real
 *  worker's auth middleware would set (orgId/userId derived from the bearer). */
function buildApp(orgId: string | undefined = 'org-1', userId: string | undefined = 'user-1') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (orgId !== undefined) c.set('orgId' as never, orgId as never);
    if (userId !== undefined) c.set('userId' as never, userId as never);
    await next();
  });
  app.route('/', apiTokensAdmin);
  return app;
}

describe('apiTokensAdmin — unconditional after 0614 un-flag (public_api gate removed)', () => {
  it('GET /api/v1-tokens returns 200 (NOT 404) for an authed org even with the flag OFF', async () => {
    const res = await buildApp().request('/api/v1-tokens', {}, env);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });

  it('GET /api/v1-tokens still returns 401 when unauthenticated (auth guard intact)', async () => {
    const res = await buildApp('', '').request('/api/v1-tokens', {}, env);
    expect(res.status).toBe(401);
  });

  it('DELETE /api/v1-tokens/:id returns 200 (NOT 404-by-flag) when the token is revoked', async () => {
    const res = await buildApp().request('/api/v1-tokens/tok-1', { method: 'DELETE' }, env);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('POST /api/v1-tokens validates the body (400) rather than 404-ing on the dead flag', async () => {
    const res = await buildApp().request(
      '/api/v1-tokens',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      },
      env,
    );
    expect(res.status).toBe(400); // reaches validation → proves it's not gated to 404
  });
});
