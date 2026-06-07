/**
 * IDOR regression for the admin token-management sub-app (`/api/v1-tokens`).
 *
 * These three routes previously read the org id from a client-supplied
 * `x-org-id` header — any caller could read, create, or revoke ANOTHER org's
 * API tokens by naming its id (a critical broken-access-control / IDOR bug).
 * The fix routes them behind the global `app.use('/api/*', authMiddleware)`
 * and derives org from `c.get('orgId')` (set from the verified bearer/session).
 *
 * This suite proves:
 *  - no authenticated org context  → 401 (even WITH an x-org-id header)
 *  - a spoofed `x-org-id` header is IGNORED — the authed org is always used
 *  - revoke is scoped to the authed org, never the header
 */

jest.mock('../modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn(async () => true),
}));

jest.mock('../services/api_tokens.js', () => {
  const actual = jest.requireActual('../services/api_tokens.js');
  return {
    ...actual,
    listApiTokens: jest.fn(),
    createApiToken: jest.fn(),
    revokeApiToken: jest.fn(),
  };
});

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { publicApiV1 } from '../routes/public_api.js';
import {
  listApiTokens,
  createApiToken,
  revokeApiToken,
} from '../services/api_tokens.js';

const mockList = listApiTokens as unknown as jest.Mock;
const mockCreate = createApiToken as unknown as jest.Mock;
const mockRevoke = revokeApiToken as unknown as jest.Mock;

const env = { DB: {} } as unknown as Env;

/** Mounts publicApiV1 with NO auth context — mirrors an unauthenticated hit. */
function anonApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', publicApiV1);
  return app;
}

/** Mounts publicApiV1 behind a middleware that sets the authed org id —
 *  mirrors the real `authMiddleware` populating `c.get('orgId')`. */
function authedApp(orgId: string) {
  const app = new Hono<{ Bindings: Env; Variables: { orgId: string } }>();
  app.use('*', async (c, next) => {
    c.set('orgId', orgId);
    await next();
  });
  app.route('/', publicApiV1);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('token management IDOR protection', () => {
  it('GET /api/v1-tokens returns 401 when unauthenticated, even with x-org-id header', async () => {
    const res = await anonApp().request(
      '/api/v1-tokens',
      { headers: { 'x-org-id': 'org-victim' } },
      env,
    );
    expect(res.status).toBe(401);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('GET /api/v1-tokens ignores a spoofed x-org-id and uses the authed org', async () => {
    mockList.mockResolvedValue([{ id: 't1', name: 'CI', prefix: 'psk_abc', scopes: ['sites:read'] }]);
    const res = await authedApp('org-good').request(
      '/api/v1-tokens',
      { headers: { 'x-org-id': 'org-evil' } },
      env,
    );
    expect(res.status).toBe(200);
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList).toHaveBeenCalledWith(expect.anything(), 'org-good');
    expect(mockList).not.toHaveBeenCalledWith(expect.anything(), 'org-evil');
  });

  it('POST /api/v1-tokens creates against the authed org, not the header', async () => {
    mockCreate.mockResolvedValue({ token: { id: 't2', name: 'New', prefix: 'psk_xyz', scopes: ['sites:read'] }, plaintext: 'psk_xyz_secret' });
    const res = await authedApp('org-good').request(
      '/api/v1-tokens',
      {
        method: 'POST',
        headers: { 'x-org-id': 'org-evil', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New', scopes: ['sites:read'] }),
      },
      env,
    );
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(expect.anything(), 'org-good', 'New', ['sites:read'], null, null);
    const body = (await res.json()) as { plaintext?: string; warning?: string };
    expect(body.plaintext).toBe('psk_xyz_secret');
    expect(body.warning).toMatch(/will not be shown again/i);
  });

  it('POST /api/v1-tokens returns 401 when unauthenticated', async () => {
    const res = await anonApp().request(
      '/api/v1-tokens',
      {
        method: 'POST',
        headers: { 'x-org-id': 'org-evil', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Sneaky' }),
      },
      env,
    );
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('DELETE /api/v1-tokens/:id revokes scoped to the authed org, ignoring x-org-id', async () => {
    mockRevoke.mockResolvedValue(true);
    const res = await authedApp('org-good').request(
      '/api/v1-tokens/tok-123',
      { method: 'DELETE', headers: { 'x-org-id': 'org-evil' } },
      env,
    );
    expect(res.status).toBe(204);
    expect(mockRevoke).toHaveBeenCalledWith(expect.anything(), 'org-good', 'tok-123');
  });

  it('DELETE /api/v1-tokens/:id returns 401 when unauthenticated', async () => {
    const res = await anonApp().request(
      '/api/v1-tokens/tok-123',
      { method: 'DELETE', headers: { 'x-org-id': 'org-evil' } },
      env,
    );
    expect(res.status).toBe(401);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});
