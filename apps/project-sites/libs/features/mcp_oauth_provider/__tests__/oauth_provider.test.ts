/**
 * Tests for the MCP OAuth 2.1 authorization server.
 * Mocks flag gate + api_tokens + KV so no network/DB hits.
 * Covers: flag-off 404, DCR, authorize (browser + API), token exchange.
 */
import { Hono } from 'hono';

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

const mockVerify = jest.fn();
const mockCreate = jest.fn();
jest.mock('../../../../src/services/api_tokens.js', () => ({
  verifyApiToken: (...a: unknown[]) => mockVerify(...a),
  extractBearerToken: (h: string | null) => (h ? h.replace(/^Bearer\s+/i, '') : null),
  createApiToken: (...a: unknown[]) => mockCreate(...a),
  hasScope: () => true,
}));

import { oauthProvider } from '../handlers.js';

// Minimal KV mock
function makeKv(store: Map<string, string> = new Map()) {
  return {
    put: jest.fn(async (key: string, val: string, _opts?: unknown) => {
      store.set(key, val);
    }),
    get: jest.fn(async (key: string, type: string) => {
      const raw = store.get(key);
      if (!raw) return null;
      if (type === 'json') return JSON.parse(raw);
      return raw;
    }),
    delete: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

function app(kv: ReturnType<typeof makeKv>) {
  const a = new Hono();
  a.route('/', oauthProvider);
  return a;
}

const baseEnv = (kv: ReturnType<typeof makeKv>) => ({ CACHE_KV: kv } as never);

beforeEach(() => {
  mockIsFlagOn.mockReset();
  mockVerify.mockReset();
  mockCreate.mockReset();
});

// ─────────────────────────────────────────────────────────────
// Flag-off guard
// ─────────────────────────────────────────────────────────────
describe('flag-off behaviour', () => {
  it('GET /.well-known/oauth-authorization-server returns 404 when flag off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const kv = makeKv();
    const res = await app(kv).request('/.well-known/oauth-authorization-server', {}, baseEnv(kv));
    expect(res.status).toBe(404);
  });

  it('POST /oauth/register returns 404 when flag off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'test', redirect_uris: ['https://example.com/cb'] }),
    }, baseEnv(kv));
    expect(res.status).toBe(404);
  });

  it('POST /api/oauth/authorize returns 404 when flag off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const kv = makeKv();
    const res = await app(kv).request('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }, baseEnv(kv));
    expect(res.status).toBe(404);
  });

  it('POST /oauth/token returns 404 when flag off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }, baseEnv(kv));
    expect(res.status).toBe(404);
  });

  it('GET /oauth/authorize returns 404 when flag off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const kv = makeKv();
    const res = await app(kv).request(
      '/oauth/authorize?client_id=x&redirect_uri=https%3A%2F%2Fex.com%2Fcb&code_challenge=abc&code_challenge_method=S256',
      {},
      baseEnv(kv),
    );
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
// RFC 8414 metadata
// ─────────────────────────────────────────────────────────────
describe('GET /.well-known/oauth-authorization-server', () => {
  it('returns RFC 8414 JSON with required fields', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const res = await app(kv).request('/.well-known/oauth-authorization-server', {}, baseEnv(kv));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.issuer).toBe('string');
    expect(body.response_types_supported).toContain('code');
    expect(body.grant_types_supported).toContain('authorization_code');
    expect((body.code_challenge_methods_supported as string[]).includes('S256')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// DCR — POST /oauth/register
// ─────────────────────────────────────────────────────────────
describe('POST /oauth/register', () => {
  it('rejects non-https redirect_uri that is not loopback', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'bad client',
        redirect_uris: ['http://evil.com/cb'],
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_redirect_uri');
  });

  it('accepts https redirect_uri and returns 201 + client_id', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude Code',
        redirect_uris: ['https://example.com/oauth/callback'],
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(201);
    const body = await res.json() as { client_id: string };
    expect(typeof body.client_id).toBe('string');
    expect(body.client_id.length).toBeGreaterThan(0);
  });

  it('accepts loopback http redirect_uri (127.0.0.1)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Local App',
        redirect_uris: ['http://127.0.0.1:8080/cb'],
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(201);
  });

  it('accepts loopback http redirect_uri (localhost)', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Local App',
        redirect_uris: ['http://localhost:3000/cb'],
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────
// Browser authorize redirect — GET /oauth/authorize
// ─────────────────────────────────────────────────────────────
describe('GET /oauth/authorize', () => {
  it('returns 400 when required query params are missing', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/authorize?client_id=x', {}, baseEnv(kv));
    expect(res.status).toBe(400);
  });

  it('redirects to /oauth/consent with original query string when params valid', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const url = '/oauth/authorize?client_id=test-client&redirect_uri=https%3A%2F%2Fex.com%2Fcb&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&code_challenge_method=S256&state=st1';
    const res = await app(kv).request(url, {}, baseEnv(kv));
    expect(res.status).toBe(302);
    const loc = res.headers.get('location') ?? '';
    expect(loc).toContain('/oauth/consent');
    expect(loc).toContain('client_id=test-client');
  });
});

// ─────────────────────────────────────────────────────────────
// API authorize — POST /api/oauth/authorize
// ─────────────────────────────────────────────────────────────
describe('POST /api/oauth/authorize', () => {
  it('returns 401 when no bearer token', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue(null);
    const kv = makeKv();
    const res = await app(kv).request('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: 'some-client',
        redirect_uri: 'https://example.com/cb',
        code_challenge: 'abc',
        code_challenge_method: 'S256',
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(401);
  });

  it('returns 400 when code_challenge_method is not S256', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', id: 'token-1', scopes: '["sites:read"]' });
    const kv = makeKv();
    const res = await app(kv).request('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer psk_test' },
      body: JSON.stringify({
        client_id: 'c1',
        redirect_uri: 'https://ex.com/cb',
        code_challenge: 'abc',
        code_challenge_method: 'plain',
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(400);
  });

  it('returns 400 when client_id not found in KV', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', id: 'token-1', scopes: '["sites:read"]' });
    const kv = makeKv(); // empty KV — client not registered
    const res = await app(kv).request('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer psk_test' },
      body: JSON.stringify({
        client_id: 'unknown-client',
        redirect_uri: 'https://ex.com/cb',
        code_challenge: 'abc',
        code_challenge_method: 'S256',
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(400);
  });

  it('returns redirect_uri with code when client is registered and everything matches', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    mockVerify.mockResolvedValue({ org_id: 'org-1', id: 'token-1', scopes: '["sites:read"]' });

    // Pre-seed KV with a registered client
    const store = new Map<string, string>();
    const clientId = 'test-client-123';
    store.set(`oauth_client:${clientId}`, JSON.stringify({
      client_id: clientId,
      client_name: 'Test Client',
      redirect_uris: ['https://example.com/cb'],
      created_at: new Date().toISOString(),
    }));
    const kv = makeKv(store);

    const res = await app(kv).request('/api/oauth/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer psk_test' },
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: 'https://example.com/cb',
        code_challenge: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        code_challenge_method: 'S256',
        scope: 'sites:read',
        state: 'random_state_xyz',
      }),
    }, baseEnv(kv));

    expect(res.status).toBe(200);
    const body = await res.json() as { redirect_uri: string };
    expect(body.redirect_uri).toContain('code=');
    expect(body.redirect_uri).toContain('state=random_state_xyz');
    expect(body.redirect_uri).toContain('https://example.com/cb');
  });
});

// ─────────────────────────────────────────────────────────────
// Token exchange — POST /oauth/token
// ─────────────────────────────────────────────────────────────
describe('POST /oauth/token', () => {
  it('returns 400 when grant_type is not authorization_code', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    }, baseEnv(kv));
    expect(res.status).toBe(400);
  });

  it('returns 400 when code does not exist in KV', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    const res = await app(kv).request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: 'nonexistent',
        client_id: 'c1',
        redirect_uri: 'https://ex.com/cb',
        code_verifier: 'pkce_verifier_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_grant');
  });

  it('accepts form-urlencoded body as well as JSON', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const kv = makeKv();
    // Not seeding a code, but the endpoint must parse the form body and
    // return 400 (invalid_grant) — proving it accepted the content-type.
    const res = await app(kv).request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&code=badcode&client_id=c1&redirect_uri=https%3A%2F%2Fex.com%2Fcb&code_verifier=pkce_verifier_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }, baseEnv(kv));
    // 400 invalid_grant (not 422 parse error) proves body was parsed
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_grant');
    expect(res.status).toBe(400);
  });

  /** base64url(SHA-256(verifier)) — the real PKCE S256 challenge, computed with WebCrypto
   *  (available as a global in Node/jest), so the happy path exercises real crypto. */
  async function s256(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return Buffer.from(new Uint8Array(digest)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  it('rejects a wrong PKCE verifier with invalid_grant', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const store = new Map<string, string>();
    store.set('oauth_code:c-pkce', JSON.stringify({
      client_id: 'client-tok',
      redirect_uri: 'https://example.com/cb',
      code_challenge: await s256('the_real_verifier_value_123456'),
      scope: 'sites:read',
      org_id: 'org-1',
      expires_at: Math.floor(Date.now() / 1000) + 300,
    }));
    const kv = makeKv(store);
    const res = await app(kv).request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code', code: 'c-pkce', client_id: 'client-tok',
        redirect_uri: 'https://example.com/cb', code_verifier: 'pkce_verifier_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    }, baseEnv(kv));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
    expect(mockCreate).not.toHaveBeenCalled(); // no token minted on PKCE failure
  });

  it('mints the psk_ PLAINTEXT as access_token on a valid exchange + enforces single-use', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const verifier = 'pkce_verifier_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const store = new Map<string, string>();
    store.set('oauth_code:good', JSON.stringify({
      client_id: 'client-ok',
      redirect_uri: 'https://example.com/cb',
      code_challenge: await s256(verifier),
      scope: 'sites:read sites:write',
      org_id: 'org-1',
      created_by_token_id: 'tok-1',
      expires_at: Math.floor(Date.now() / 1000) + 300,
    }));
    const kv = makeKv(store);
    // Mirror the REAL createApiToken return shape: { token: <public row>, plaintext: <psk_ string> }.
    mockCreate.mockResolvedValue({ token: { id: 'tok-new', org_id: 'org-1' }, plaintext: 'psk_realsecret' });

    const body = {
      grant_type: 'authorization_code', code: 'good', client_id: 'client-ok',
      redirect_uri: 'https://example.com/cb', code_verifier: verifier,
    };
    const res = await app(kv).request('/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, baseEnv(kv));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { access_token: string; token_type: string; scope: string };
    expect(json.access_token).toBe('psk_realsecret'); // the PLAINTEXT, not the row object (regression guard)
    expect(json.token_type).toBe('Bearer');
    expect(json.scope).toBe('sites:read sites:write');
    // createApiToken got the org + the consented scopes from the code record.
    const args = mockCreate.mock.calls[0];
    expect(args[1]).toBe('org-1');
    expect(args[3]).toEqual(['sites:read', 'sites:write']);

    // Single-use: the code was deleted on first exchange → replay fails.
    const replay = await app(kv).request('/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, baseEnv(kv));
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects an expired authorization code with invalid_grant', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const verifier = 'pkce_verifier_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const store = new Map<string, string>();
    store.set('oauth_code:exp', JSON.stringify({
      client_id: 'c', redirect_uri: 'https://ex.com/cb',
      code_challenge: await s256(verifier), scope: 'sites:read', org_id: 'org-1',
      expires_at: Math.floor(Date.now() / 1000) - 10, // already expired
    }));
    const kv = makeKv(store);
    const res = await app(kv).request('/oauth/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: 'exp', client_id: 'c', redirect_uri: 'https://ex.com/cb', code_verifier: verifier }),
    }, baseEnv(kv));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('returns 400 when client_id does not match stored code', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const store = new Map<string, string>();
    store.set('oauth_code:c999', JSON.stringify({
      code: 'c999',
      client_id: 'real-client',
      redirect_uri: 'https://ex.com/cb',
      scope: 'sites:read',
      org_id: 'org-1',
      created_at: new Date().toISOString(),
    }));
    const kv = makeKv(store);

    const res = await app(kv).request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: 'c999',
        client_id: 'wrong-client',
        redirect_uri: 'https://ex.com/cb',
        code_verifier: 'pkce_verifier_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      }),
    }, baseEnv(kv));

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('invalid_grant');
  });
});
