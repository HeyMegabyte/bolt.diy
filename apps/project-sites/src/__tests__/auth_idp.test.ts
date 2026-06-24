/**
 * auth_idp — Logto (default) + WorkOS (enterprise) IdP login + callback routes (ADR-0006).
 *
 * Exercises the `authIdp` Hono instance directly (no full-worker import) with the
 * identity factory + auth/audit services mocked. Covers: ships-dark 404, login 302 +
 * CSRF-state store, unknown-provider 404, callback missing-code/invalid-state guards,
 * and the happy callback → findOrCreateUser → createSession → token-redirect handoff.
 *
 * middleware/identity.js + services/auth.js + services/audit.js are mocked so no real
 * OIDC fetch or D1 I/O happens. Global `jest`; casts via `as unknown as jest.Mock`.
 */
jest.mock('../middleware/identity.js', () => ({ getIdentityProvider: jest.fn() }));
jest.mock('../services/auth.js', () => ({ findOrCreateUser: jest.fn(), createSession: jest.fn() }));
jest.mock('../services/audit.js', () => ({ writeAuditLog: jest.fn() }));

import { Hono } from 'hono';
import { authIdp } from '../routes/auth_idp.js';
import { getIdentityProvider } from '../middleware/identity.js';
import { findOrCreateUser, createSession } from '../services/auth.js';
import { writeAuditLog } from '../services/audit.js';

const mGetIdp = getIdentityProvider as unknown as jest.Mock;
const mFindOrCreateUser = findOrCreateUser as unknown as jest.Mock;
const mCreateSession = createSession as unknown as jest.Mock;
const mWriteAuditLog = writeAuditLog as unknown as jest.Mock;

/** Minimal Map-backed KV stub matching the get/put/delete surface the route uses. */
function makeKv(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    put: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    delete: jest.fn(async (k: string) => void store.delete(k)),
    _store: store,
  };
}

const fakeIdp = {
  createLoginUrl: jest.fn(
    async (i: { redirectUri: string; state: string }) =>
      `https://idp.example/authorize?redirect_uri=${encodeURIComponent(i.redirectUri)}&state=${i.state}`,
  ),
  handleCallback: jest.fn(async () => ({
    subject: 'sub_123',
    email: 'owner@example.com',
    name: 'Test Owner',
    provider: 'logto' as const,
  })),
  validateSession: jest.fn(),
  logout: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mGetIdp.mockReturnValue(fakeIdp);
  mFindOrCreateUser.mockResolvedValue({ user_id: 'u_1', org_id: 'o_1', is_new: true });
  mCreateSession.mockResolvedValue({ token: 'sess_abc', expires_at: '2099-01-01' });
  mWriteAuditLog.mockResolvedValue(undefined);
});

function env(kv = makeKv()) {
  return { CACHE_KV: kv, DB: {} } as never;
}

describe('GET /api/auth/:provider/login', () => {
  it('404s for an unknown provider', async () => {
    const res = await authIdp.request('/api/auth/github/login', {}, env());
    expect(res.status).toBe(404);
  });

  it('404s (ships dark) when the provider is not configured', async () => {
    mGetIdp.mockReturnValue(null);
    const res = await authIdp.request('/api/auth/logto/login', {}, env());
    expect(res.status).toBe(404);
  });

  it('302s to the IdP authorize URL and stores the CSRF state', async () => {
    const kv = makeKv();
    const res = await authIdp.request('/api/auth/logto/login', {}, env(kv));
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('https://idp.example/authorize');
    const stored = [...kv._store.entries()].find(([k]) => k.startsWith('authstate:'));
    expect(stored?.[1]).toBe('logto');
  });

  it('routes WorkOS as the enterprise provider', async () => {
    await authIdp.request('/api/auth/workos/login', {}, env());
    expect(mGetIdp).toHaveBeenCalledWith(expect.anything(), { enterprise: true });
  });
});

describe('GET /api/auth/:provider/callback', () => {
  it('redirects to ?error=missing_code when code is absent', async () => {
    const res = await authIdp.request('/api/auth/logto/callback?state=s1', {}, env());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?error=missing_code');
  });

  it('redirects to ?error=invalid_state when the state is unknown', async () => {
    const res = await authIdp.request('/api/auth/logto/callback?code=c1&state=bogus', {}, env());
    expect(res.headers.get('location')).toBe('/?error=invalid_state');
  });

  it('exchanges the code, issues a D1 session, and redirects with the token', async () => {
    const kv = makeKv({ 'authstate:s1': 'logto' });
    const res = await authIdp.request('/api/auth/logto/callback?code=c1&state=s1', {}, env(kv));
    expect(fakeIdp.handleCallback).toHaveBeenCalledWith(expect.objectContaining({ code: 'c1' }));
    expect(mFindOrCreateUser).toHaveBeenCalledWith(expect.anything(), {
      email: 'owner@example.com',
      display_name: 'Test Owner',
    });
    expect(mCreateSession).toHaveBeenCalledWith(expect.anything(), 'u_1', 'logto');
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('token=sess_abc');
    expect(location).toContain('auth_callback=logto');
    expect(kv._store.has('authstate:s1')).toBe(false);
  });

  it('redirects to ?error=auth_failed when the exchange throws', async () => {
    fakeIdp.handleCallback.mockRejectedValueOnce(new Error('token exchange failed'));
    const kv = makeKv({ 'authstate:s1': 'logto' });
    const res = await authIdp.request('/api/auth/logto/callback?code=c1&state=s1', {}, env(kv));
    expect(res.headers.get('location')).toBe('/?error=auth_failed');
  });
});

/**
 * Regression: the `:provider/callback` wildcard is mounted BEFORE the `api` router's
 * dedicated `/api/auth/google/callback` in `index.ts`. It MUST fall through (not 404)
 * for non-Logto/WorkOS providers, or every Google sign-in dies on the SPA 404 page.
 * Reproduces the prod incident where Google OAuth callbacks returned 404.
 */
describe('non-IdP provider fall-through (shadow regression)', () => {
  function composite() {
    const app = new Hono();
    app.route('/', authIdp); // wildcard :provider routes registered first (as in index.ts)
    app.get('/api/auth/google/callback', (c) => c.text('google-handled', 200));
    app.get('/api/auth/github/callback', (c) => c.text('github-handled', 200));
    return app;
  }

  it('callback falls through to the downstream Google handler instead of 404', async () => {
    const res = await composite().request('/api/auth/google/callback?code=c&state=s', {}, env());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('google-handled');
  });

  it('callback falls through to the downstream GitHub handler', async () => {
    const res = await composite().request('/api/auth/github/callback?code=c&state=s', {}, env());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('github-handled');
  });

  it('still handles its own logto callback (does not fall through)', async () => {
    const kv = makeKv({ 'authstate:s1': 'logto' });
    const res = await composite().request('/api/auth/logto/callback?code=c1&state=s1', {}, env(kv));
    expect(res.status).toBe(302);
    expect(res.headers.get('location') ?? '').toContain('token=sess_abc');
  });

  it('genuinely unknown provider with no downstream handler still 404s', async () => {
    const res = await composite().request('/api/auth/bogus/callback?code=c&state=s', {}, env());
    expect(res.status).toBe(404);
  });
});
