/**
 * Unit coverage for `authMiddleware` — the Bearer-token gate in front of EVERY
 * admin/API route. Previously untested: `auth.test.ts` covers the auth *service*
 * (magic-link, sessions, OAuth) and `middleware.test.ts` covers requestId /
 * payload / security-headers, but nothing exercised the middleware's two auth
 * paths. This locks the security-critical behavior:
 *
 *   API-key path (Bearer psk_live_/psk_test_):
 *     - keys are matched by SHA-256 HASH, never the raw secret
 *     - valid key → userId/orgId from the key row
 *     - expired key → NOT authed
 *     - unknown / revoked key (query returns null) → NOT authed
 *   Session path (any other Bearer):
 *     - valid session → userId + primary-org membership
 *     - valid session, no membership → userId only
 *     - invalid session → NOT authed
 *   No / non-Bearer header → request proceeds with no auth context.
 *
 * The middleware never rejects — routes enforce auth by reading `userId`. So
 * each test asserts the resolved context, not the HTTP status.
 */

const mockGetSession = jest.fn();
const mockDbQueryOne = jest.fn();

jest.mock('../services/auth.js', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));
jest.mock('../services/db.js', () => ({
  dbQueryOne: (...args: unknown[]) => mockDbQueryOne(...args),
}));
jest.mock('../lib/sentry.js', () => ({
  setUser: jest.fn(),
}));

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';

interface AuthProbe {
  userId: string | null;
  orgId: string | null;
}

function createApp() {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.use('*', authMiddleware);
  app.get('/probe', (c) =>
    c.json<AuthProbe>({ userId: c.get('userId') ?? null, orgId: c.get('orgId') ?? null }),
  );
  return app;
}

const env = {
  DB: {
    // Only the best-effort `UPDATE api_keys SET last_used_at` runs through here.
    prepare: () => ({ bind: () => ({ run: () => Promise.resolve() }) }),
  },
} as any;

const ctx = { waitUntil: jest.fn(), passThroughOnException: jest.fn() } as any;

function request(headers: Record<string, string> = {}): Promise<Response> {
  return createApp().request('/probe', { headers }, env, ctx);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('authMiddleware — API-key (psk_) path', () => {
  it('matches the key by SHA-256 hash, never the raw token', async () => {
    const token = 'psk_test_deadbeefcafef00d';
    mockDbQueryOne.mockResolvedValue({ id: 'k1', org_id: 'org-1', created_by: 'user-1', expires_at: null });

    await request({ Authorization: `Bearer ${token}` });

    expect(mockDbQueryOne).toHaveBeenCalledTimes(1);
    const [, sql, params] = mockDbQueryOne.mock.calls[0];
    expect(sql).toContain('api_keys');
    const hash = (params as string[])[0];
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(hash).not.toBe(token); // never the plaintext secret
  });

  it('authenticates a valid, non-expired key as its creator + org', async () => {
    mockDbQueryOne.mockResolvedValue({ id: 'k1', org_id: 'org-9', created_by: 'user-7', expires_at: null });
    const res = await request({ Authorization: 'Bearer psk_live_validkey123' });
    const body = (await res.json()) as AuthProbe;
    expect(body).toEqual({ userId: 'user-7', orgId: 'org-9' });
  });

  it('honors a future expiry', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    mockDbQueryOne.mockResolvedValue({ id: 'k1', org_id: 'org-9', created_by: 'user-7', expires_at: future });
    const res = await request({ Authorization: 'Bearer psk_test_future' });
    expect(await res.json()).toEqual({ userId: 'user-7', orgId: 'org-9' });
  });

  it('does NOT authenticate an expired key', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    mockDbQueryOne.mockResolvedValue({ id: 'k1', org_id: 'org-9', created_by: 'user-7', expires_at: past });
    const res = await request({ Authorization: 'Bearer psk_test_expired' });
    expect(await res.json()).toEqual({ userId: null, orgId: null });
  });

  it('does NOT authenticate an unknown / revoked key (no row)', async () => {
    mockDbQueryOne.mockResolvedValue(null);
    const res = await request({ Authorization: 'Bearer psk_live_revoked' });
    expect(await res.json()).toEqual({ userId: null, orgId: null });
    expect(mockGetSession).not.toHaveBeenCalled(); // never falls through to the session path
  });
});

describe('authMiddleware — session path', () => {
  it('authenticates a valid session + resolves the primary org', async () => {
    mockGetSession.mockResolvedValue({ user_id: 'user-42' });
    mockDbQueryOne.mockResolvedValue({ org_id: 'org-42' }); // membership lookup
    const res = await request({ Authorization: 'Bearer sess_abc123' });
    expect(await res.json()).toEqual({ userId: 'user-42', orgId: 'org-42' });
  });

  it('sets userId but not orgId when the user has no membership', async () => {
    mockGetSession.mockResolvedValue({ user_id: 'user-42' });
    mockDbQueryOne.mockResolvedValue(null); // no membership
    const res = await request({ Authorization: 'Bearer sess_no_org' });
    expect(await res.json()).toEqual({ userId: 'user-42', orgId: null });
  });

  it('does NOT authenticate an invalid session', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await request({ Authorization: 'Bearer sess_invalid' });
    expect(await res.json()).toEqual({ userId: null, orgId: null });
  });
});

describe('authMiddleware — no / malformed header', () => {
  it('proceeds with no auth context when no Authorization header', async () => {
    const res = await request();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: null, orgId: null });
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockDbQueryOne).not.toHaveBeenCalled();
  });

  it('ignores a non-Bearer Authorization scheme', async () => {
    const res = await request({ Authorization: 'Basic dXNlcjpwYXNz' });
    expect(await res.json()).toEqual({ userId: null, orgId: null });
  });
});
