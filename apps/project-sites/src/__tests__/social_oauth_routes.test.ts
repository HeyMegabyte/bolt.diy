/**
 * Route coverage for `social_oauth` — Pulse Social per-platform OAuth bootstrap
 * (convergence r41).
 *
 * Exercises the three handlers end-to-end through the real Hono app + the shared
 * {@link errorHandler}, mocking only the boundaries (publisher registry, Bluesky/
 * Mastodon verify helpers, AES-GCM crypto, KV state store, D1 upsert).
 *
 *   GET  /api/social/:platform/connect              → authorize URL / paste-key spec
 *   GET  /api/social/:platform/callback?code&state  → code exchange + encrypt + upsert
 *   POST /api/social/:platform/paste                → paste-key/login flow
 *
 * Covers: auth 401, unknown-platform 404, paste-key spec (no OAuth), authorize-URL
 * build + KV state persistence, missing-app-creds 501, callback state validation
 * (missing / expired / platform-mismatch), token exchange + encryption-at-rest
 * persistence, upstream exchange failure 502, paste-flow per platform, Zod 400, and
 * org/user scoping into the encrypted D1 row.
 */

jest.mock('../services/ai_crypto.js', () => ({
  encrypt: jest.fn(async (_env: unknown, plaintext: string) => `enc(${plaintext})`),
}));

jest.mock('../services/db.js', () => ({
  dbExecute: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../services/social_publishers/index.js', () => {
  class MissingAppCredsError extends Error {
    readonly platform: string;
    readonly deeplink: string;
    constructor(platform: string, deeplink: string) {
      super(`Missing app credentials for ${platform}`);
      this.platform = platform;
      this.deeplink = deeplink;
      this.name = 'MissingAppCredsError';
    }
  }
  return {
    PLATFORMS: [
      'twitter',
      'linkedin',
      'facebook',
      'instagram',
      'threads',
      'bluesky',
      'reddit',
      'mastodon',
      'discord',
      'slack',
      'telegram',
    ],
    MissingAppCredsError,
    getPublisher: jest.fn(),
  };
});

jest.mock('../services/social_publishers/bluesky.js', () => ({
  blueskyLogin: jest.fn(),
}));

jest.mock('../services/social_publishers/mastodon.js', () => ({
  mastodonVerify: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { socialOauthRoutes } from '../routes/social_oauth.js';
import { encrypt } from '../services/ai_crypto.js';
import { dbExecute } from '../services/db.js';
import { getPublisher, MissingAppCredsError } from '../services/social_publishers/index.js';
import { blueskyLogin } from '../services/social_publishers/bluesky.js';
import { mastodonVerify } from '../services/social_publishers/mastodon.js';

const mockEncrypt = encrypt as unknown as jest.Mock;
const mockDbExecute = dbExecute as unknown as jest.Mock;
const mockGetPublisher = getPublisher as unknown as jest.Mock;
const mockBlueskyLogin = blueskyLogin as unknown as jest.Mock;
const mockMastodonVerify = mastodonVerify as unknown as jest.Mock;

// ─── Boundary mocks ──────────────────────────────────────────────────────────

/** In-memory KV mock for the `social-oauth-state:{state}` store. */
function makeKv(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    put: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    _store: store,
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    CACHE_KV: makeKv(),
    MCP_ENCRYPTION_KEY: 'x',
    ...overrides,
  } as unknown as Env;
}

// ─── App harness ─────────────────────────────────────────────────────────────

/**
 * Build the app with a middleware that seeds the auth context vars the
 * connect/paste handlers read (`userId`, `orgId`). Passing no vars simulates an
 * unauthenticated request. The callback handler is intentionally unauthenticated
 * (it validates via the KV state row instead).
 */
function makeApp(vars: Partial<Variables> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  app.route('/', socialOauthRoutes);
  return app;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (_p: Promise<unknown>) => {},
    passThroughOnException: () => {},
  } as unknown as ExecutionContext;
}

const AUTH: Partial<Variables> = { userId: 'user-1', orgId: 'org-1', requestId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockEncrypt.mockImplementation(async (_env: unknown, plaintext: string) => `enc(${plaintext})`);
  mockDbExecute.mockResolvedValue({ success: true });
});

// ─── GET /api/social/:platform/connect ───────────────────────────────────────

describe('GET /api/social/:platform/connect', () => {
  it('returns 401 when org/user context is missing', async () => {
    const env = makeEnv();
    const res = await makeApp().request('/api/social/twitter/connect', {}, env, makeCtx());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockGetPublisher).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown platform', async () => {
    const env = makeEnv();
    const res = await makeApp(AUTH).request('/api/social/myspace/connect', {}, env, makeCtx());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
    expect(mockGetPublisher).not.toHaveBeenCalled();
  });

  it('returns a paste-key spec for a platform with no OAuth dance (bluesky)', async () => {
    mockGetPublisher.mockReturnValue({}); // no authorizeUrl → paste-key
    const env = makeEnv();
    const res = await makeApp(AUTH).request('/api/social/bluesky/connect', {}, env, makeCtx());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { mode: string; platform: string; instructions: string } };
    expect(json.data.mode).toBe('paste_key');
    expect(json.data.platform).toBe('bluesky');
    expect(json.data.instructions).toMatch(/app-passwords/i);
    // Paste-key path never persists state.
    expect((env.CACHE_KV as unknown as { put: jest.Mock }).put).not.toHaveBeenCalled();
  });

  it('builds the authorize URL, redirects 302, and stashes PKCE state in KV', async () => {
    let captured: { state: string; codeVerifier: string; redirectUri: string } | null = null;
    mockGetPublisher.mockReturnValue({
      authorizeUrl: (_env: unknown, args: { state: string; codeVerifier: string; redirectUri: string }) => {
        captured = args;
        return `https://twitter.com/i/oauth2/authorize?state=${args.state}`;
      },
    });
    const env = makeEnv();
    const res = await makeApp(AUTH).request(
      '/api/social/twitter/connect?site_id=site-9&return_url=/admin/social',
      { redirect: 'manual' },
      env,
      makeCtx(),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(/twitter\.com\/i\/oauth2\/authorize/);

    const kv = env.CACHE_KV as unknown as { put: jest.Mock; _store: Map<string, string> };
    expect(kv.put).toHaveBeenCalledTimes(1);
    const [key, value, opts] = kv.put.mock.calls[0];
    expect(key).toMatch(/^social-oauth-state:/);
    expect(opts).toEqual({ expirationTtl: 300 });
    const stored = JSON.parse(value as string) as Record<string, unknown>;
    expect(stored).toMatchObject({
      org_id: 'org-1',
      user_id: 'user-1',
      site_id: 'site-9',
      platform: 'twitter',
      return_url: '/admin/social',
    });
    // The redirect URI passed to the publisher must match the callback path.
    expect(captured!.redirectUri).toMatch(/\/api\/social\/twitter\/callback$/);
    // State + verifier round-trip into KV.
    expect(stored['code_verifier']).toBe(captured!.codeVerifier);
    expect(key).toBe(`social-oauth-state:${captured!.state}`);
  });

  it('returns 501 APP_CREDS_MISSING with deeplink when the publisher throws MissingAppCredsError', async () => {
    mockGetPublisher.mockReturnValue({
      authorizeUrl: () => {
        throw new MissingAppCredsError('twitter' as never, 'https://developer.twitter.com');
      },
    });
    const env = makeEnv();
    const res = await makeApp(AUTH).request('/api/social/twitter/connect', {}, env, makeCtx());
    expect(res.status).toBe(501);
    const json = (await res.json()) as { error?: { code?: string; deeplink?: string } };
    expect(json.error?.code).toBe('APP_CREDS_MISSING');
    expect(json.error?.deeplink).toBe('https://developer.twitter.com');
    expect((env.CACHE_KV as unknown as { put: jest.Mock }).put).not.toHaveBeenCalled();
  });

  it('returns 501 APP_CREDS_MISSING when the publisher returns a null authorize URL', async () => {
    mockGetPublisher.mockReturnValue({ authorizeUrl: () => null });
    const env = makeEnv();
    const res = await makeApp(AUTH).request('/api/social/linkedin/connect', {}, env, makeCtx());
    expect(res.status).toBe(501);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('APP_CREDS_MISSING');
  });
});

// ─── GET /api/social/:platform/callback ──────────────────────────────────────

describe('GET /api/social/:platform/callback', () => {
  function storedStateFor(platform: string) {
    return JSON.stringify({
      org_id: 'org-1',
      user_id: 'user-1',
      site_id: 'site-9',
      platform,
      code_verifier: 'verifier-123',
      return_url: '/admin/social',
      redirect_uri: 'https://projectsites.dev/api/social/twitter/callback',
    });
  }

  it('returns 404 for an unknown platform', async () => {
    const env = makeEnv();
    const res = await makeApp().request('/api/social/myspace/callback?code=c&state=s', {}, env, makeCtx());
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('NOT_FOUND');
  });

  it('returns 400 when code or state is missing', async () => {
    const env = makeEnv();
    const res = await makeApp().request('/api/social/twitter/callback?code=c', {}, env, makeCtx());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when the state row is expired or missing from KV', async () => {
    const env = makeEnv(); // empty KV
    const res = await makeApp().request('/api/social/twitter/callback?code=c&state=gone', {}, env, makeCtx());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toMatch(/expired or invalid/);
  });

  it('returns 400 when the stored platform mismatches the URL platform (state-binding/CSRF guard)', async () => {
    const env = makeEnv({ CACHE_KV: makeKv({ 'social-oauth-state:s1': storedStateFor('linkedin') }) });
    const res = await makeApp().request('/api/social/twitter/callback?code=c&state=s1', {}, env, makeCtx());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toMatch(/platform mismatch/);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('returns 400 when the publisher has no exchange flow', async () => {
    mockGetPublisher.mockReturnValue({}); // no exchangeCode
    const env = makeEnv({ CACHE_KV: makeKv({ 'social-oauth-state:s1': storedStateFor('twitter') }) });
    const res = await makeApp().request('/api/social/twitter/callback?code=c&state=s1', {}, env, makeCtx());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toMatch(/no exchange flow/);
  });

  it('exchanges the code, encrypts tokens at rest, upserts org-scoped, deletes state, and redirects 302', async () => {
    const exchangeCode = jest.fn(async () => ({
      access_token: 'ACCESS-TOK',
      refresh_token: 'REFRESH-TOK',
      expires_in: 3600,
      external_id: 'ext-77',
      handle: '@acme',
      display_name: 'Acme Co',
      avatar_url: 'https://cdn/acme.png',
      scopes: 'read write',
      metadata: { foo: 'bar' },
    }));
    mockGetPublisher.mockReturnValue({ exchangeCode });
    const kv = makeKv({ 'social-oauth-state:s1': storedStateFor('twitter') });
    const env = makeEnv({ CACHE_KV: kv });

    const res = await makeApp().request(
      '/api/social/twitter/callback?code=THE-CODE&state=s1',
      { redirect: 'manual' },
      env,
      makeCtx(),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://projectsites.dev/admin/social?connected=twitter');

    // Code exchange used the stored PKCE verifier + redirect URI.
    expect(exchangeCode).toHaveBeenCalledTimes(1);
    expect(exchangeCode.mock.calls[0][1]).toMatchObject({
      code: 'THE-CODE',
      codeVerifier: 'verifier-123',
      redirectUri: 'https://projectsites.dev/api/social/twitter/callback',
    });

    // Both tokens encrypted at rest (no plaintext in the SQL params).
    expect(mockEncrypt).toHaveBeenCalledWith(expect.anything(), 'ACCESS-TOK');
    expect(mockEncrypt).toHaveBeenCalledWith(expect.anything(), 'REFRESH-TOK');

    // Upsert into social_accounts, org-scoped, with encrypted blobs.
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
    const [, sql, params] = mockDbExecute.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO social_accounts/);
    expect(sql).toMatch(/ON CONFLICT\(org_id, platform, external_id\)/);
    const p = params as unknown[];
    expect(p).toContain('org-1'); // org scoping
    expect(p).toContain('user-1'); // created_by
    expect(p).toContain('twitter');
    expect(p).toContain('ext-77');
    expect(p).toContain('enc(ACCESS-TOK)');
    expect(p).toContain('enc(REFRESH-TOK)');

    // State row consumed (one-shot).
    expect(kv.delete).toHaveBeenCalledWith('social-oauth-state:s1');
  });

  it('persists a null refresh blob + null expiry when the exchange omits them', async () => {
    const exchangeCode = jest.fn(async () => ({ access_token: 'A', external_id: 'e1' }));
    mockGetPublisher.mockReturnValue({ exchangeCode });
    const env = makeEnv({ CACHE_KV: makeKv({ 'social-oauth-state:s1': storedStateFor('twitter') }) });
    const res = await makeApp().request(
      '/api/social/twitter/callback?code=c&state=s1',
      { redirect: 'manual' },
      env,
      makeCtx(),
    );
    expect(res.status).toBe(302);
    // refresh token never encrypted when absent.
    expect(mockEncrypt).toHaveBeenCalledTimes(1);
    expect(mockEncrypt).toHaveBeenCalledWith(expect.anything(), 'A');
    const [, , params] = mockDbExecute.mock.calls[0];
    expect(params as unknown[]).toContain(null);
  });

  it('returns 501 APP_CREDS_MISSING when the exchange throws MissingAppCredsError', async () => {
    mockGetPublisher.mockReturnValue({
      exchangeCode: jest.fn(async () => {
        throw new MissingAppCredsError('twitter' as never, 'https://developer.twitter.com');
      }),
    });
    const env = makeEnv({ CACHE_KV: makeKv({ 'social-oauth-state:s1': storedStateFor('twitter') }) });
    const res = await makeApp().request('/api/social/twitter/callback?code=c&state=s1', {}, env, makeCtx());
    expect(res.status).toBe(501);
    const json = (await res.json()) as { error?: { code?: string; deeplink?: string } };
    expect(json.error?.code).toBe('APP_CREDS_MISSING');
    expect(json.error?.deeplink).toBe('https://developer.twitter.com');
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('returns 502 OAUTH_EXCHANGE_FAILED when the upstream token exchange rejects', async () => {
    mockGetPublisher.mockReturnValue({
      exchangeCode: jest.fn(async () => {
        throw new Error('upstream 400 invalid_grant');
      }),
    });
    const env = makeEnv({ CACHE_KV: makeKv({ 'social-oauth-state:s1': storedStateFor('twitter') }) });
    const res = await makeApp().request('/api/social/twitter/callback?code=c&state=s1', {}, env, makeCtx());
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(json.error?.code).toBe('OAUTH_EXCHANGE_FAILED');
    expect(json.error?.message).toMatch(/invalid_grant/);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });
});

// ─── POST /api/social/:platform/paste ────────────────────────────────────────

describe('POST /api/social/:platform/paste', () => {
  function post(platform: string, body: unknown, vars: Partial<Variables> = AUTH, env = makeEnv()) {
    return makeApp(vars).request(
      `/api/social/${platform}/paste`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
      makeCtx(),
    );
  }

  it('returns 401 when org/user context is missing', async () => {
    const res = await post('bluesky', { kind: 'bluesky', identifier: 'me.bsky.social', app_password: 'abcd1234efgh' }, {});
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code?: string } };
    expect(json.error?.code).toBe('UNAUTHORIZED');
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails Zod validation', async () => {
    const res = await post('bluesky', { kind: 'bluesky', identifier: 'x' }); // missing app_password, too-short identifier
    expect(res.status).toBe(400);
    expect(mockBlueskyLogin).not.toHaveBeenCalled();
  });

  it('connects Bluesky via app-password, encrypts both tokens, and upserts', async () => {
    mockBlueskyLogin.mockResolvedValue({
      access_token: 'BSKY-ACCESS',
      refresh_token: 'BSKY-REFRESH',
      external_id: 'did:plc:abc',
      handle: 'me.bsky.social',
      display_name: 'Me',
      expires_at: '2026-01-01T00:00:00.000Z',
    });
    const res = await post('bluesky', { kind: 'bluesky', identifier: 'me.bsky.social', app_password: 'abcd1234efgh' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { connected: boolean; platform: string; handle: string } };
    expect(json.data.connected).toBe(true);
    expect(json.data.platform).toBe('bluesky');
    expect(mockBlueskyLogin).toHaveBeenCalledWith('me.bsky.social', 'abcd1234efgh');
    expect(mockEncrypt).toHaveBeenCalledWith(expect.anything(), 'BSKY-ACCESS');
    expect(mockEncrypt).toHaveBeenCalledWith(expect.anything(), 'BSKY-REFRESH');
    const [, , params] = mockDbExecute.mock.calls[0];
    expect(params as unknown[]).toContain('org-1');
    expect(params as unknown[]).toContain('did:plc:abc');
    expect(params as unknown[]).toContain('enc(BSKY-ACCESS)');
  });

  it('connects Mastodon via access token and stores the instance URL in metadata', async () => {
    mockMastodonVerify.mockResolvedValue({
      external_id: '12345',
      handle: '@me@mastodon.social',
      display_name: 'Me',
      avatar_url: 'https://cdn/me.png',
    });
    const res = await post('mastodon', {
      kind: 'mastodon',
      instance_url: 'https://mastodon.social/',
      access_token: 'a'.repeat(40),
    });
    expect(res.status).toBe(200);
    expect(mockMastodonVerify).toHaveBeenCalledWith('https://mastodon.social/', 'a'.repeat(40));
    const [, , params] = mockDbExecute.mock.calls[0];
    // metadata_json carries the trailing-slash-stripped instance URL.
    const metaParam = (params as unknown[]).find(
      (x) => typeof x === 'string' && x.includes('instance_url'),
    ) as string;
    expect(JSON.parse(metaParam)).toEqual({ instance_url: 'https://mastodon.social' });
    // Mastodon access token is the user-pasted one, encrypted at rest.
    expect(mockEncrypt).toHaveBeenCalledWith(expect.anything(), 'a'.repeat(40));
  });

  it('connects Telegram via chat_id without an external verify call', async () => {
    const res = await post('telegram', { kind: 'telegram', chat_id: '-100123', display_name: 'My Channel' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { handle: string } };
    expect(json.data.handle).toBe('My Channel');
    expect(mockBlueskyLogin).not.toHaveBeenCalled();
    expect(mockMastodonVerify).not.toHaveBeenCalled();
    const [, , params] = mockDbExecute.mock.calls[0];
    expect(params as unknown[]).toContain('-100123'); // external_id = chat_id
  });

  it('returns 400 when the body kind mismatches the URL platform', async () => {
    // Valid bluesky body posted to the telegram route → kind/platform mismatch.
    const res = await post('telegram', { kind: 'bluesky', identifier: 'me.bsky.social', app_password: 'abcd1234efgh' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: { message?: string } };
    expect(json.error?.message).toMatch(/kind\/platform mismatch/);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });
});
