/**
 * Unit tests for LogtoIdentityProvider.
 *
 * Mirrors the structure of workos_provider_unit.test.ts.
 * Injectable fetchImpl allows full branch coverage with no jest.mock() and no
 * real network calls.
 *
 * Methods covered:
 *  - createLoginUrl  (OIDC authorize URL shape, query params, no HTTP)
 *  - handleCallback  (token exchange + userinfo fetch, happy path, error paths)
 *  - validateSession (delegates to userinfo; empty token short-circuits)
 *  - logout          (OIDC end-session URL shape)
 */

import { LogtoIdentityProvider } from '../services/logto_provider.js';
import { IdentityProviderError } from '../platform/identity.js';
import type { LogtoConfig } from '../services/logto_provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal LogtoConfig with an injectable fetch mock. */
function makeProvider(fetchImpl: jest.Mock, overrides?: Partial<LogtoConfig>) {
  return new LogtoIdentityProvider({
    endpoint: 'https://tenant.logto.app',
    appId: 'test-app-id',
    appSecret: 'test-app-secret',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  });
}

/** Minimal well-formed userinfo (OIDC /me) response body. */
function meResponse(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'logto-sub-001',
    email: 'user@example.com',
    name: 'Jane Doe',
    ...overrides,
  };
}

/** Build a mock fetch that returns a successful JSON response. */
function okFetch(body: unknown, status = 200): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status,
    json: () => Promise.resolve(body),
  });
}

/** Build a mock fetch that returns a non-ok response. */
function errFetch(status: number): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'upstream_error' }),
  });
}

/**
 * Build a mock fetch that succeeds for the first call (token exchange)
 * and succeeds/fails for the second call (userinfo).
 */
function twoStageFetch(
  tokenBody: unknown,
  userinfoBody: unknown,
  userinfoOk = true,
  userinfoStatus = 200,
): jest.Mock {
  const mock = jest.fn();
  mock
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(tokenBody),
    })
    .mockResolvedValueOnce({
      ok: userinfoOk,
      status: userinfoStatus,
      json: () => Promise.resolve(userinfoBody),
    });
  return mock;
}

// ---------------------------------------------------------------------------
// createLoginUrl
// ---------------------------------------------------------------------------

describe('LogtoIdentityProvider.createLoginUrl', () => {
  it('returns a URL pointing at the Logto OIDC authorize endpoint', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'csrf-state-abc',
    });

    expect(url).toMatch(/^https:\/\/tenant\.logto\.app\/oidc\/auth\?/);
  });

  it('strips trailing slashes from the endpoint before building the URL', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock, { endpoint: 'https://tenant.logto.app///' });

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'state',
    });

    // Should NOT produce double-slashes in the path
    expect(url).not.toContain('//oidc');
    expect(url).toContain('/oidc/auth');
  });

  it('includes client_id, redirect_uri, response_type, scope, and state params', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock, { appId: 'my-app' });

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'my-state',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('my-app');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.test/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('my-state');
    expect(parsed.searchParams.get('scope')).toContain('openid');
  });

  it('scope includes email', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'state',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toContain('email');
  });

  it('scope includes profile', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'state',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('scope')).toContain('profile');
  });

  it('makes no HTTP calls (pure URL builder)', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    await provider.createLoginUrl({ redirectUri: 'https://x.test', state: 's' });

    expect(mock).not.toHaveBeenCalled();
  });

  it('reflects different redirectUri values correctly', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.createLoginUrl({
      redirectUri: 'https://other.domain/cb',
      state: 's',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://other.domain/cb');
  });
});

// ---------------------------------------------------------------------------
// handleCallback
// ---------------------------------------------------------------------------

describe('LogtoIdentityProvider.handleCallback', () => {
  it('calls the token endpoint first with form-encoded params', async () => {
    const mock = twoStageFetch({ access_token: 'tok' }, meResponse());
    const provider = makeProvider(mock, { appId: 'aid', appSecret: 'sec' });

    await provider.handleCallback({ code: 'auth-code', redirectUri: 'https://app.test/cb' });

    const [tokenUrl, tokenInit] = mock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe('https://tenant.logto.app/oidc/token');
    expect(tokenInit.method).toBe('POST');
    expect((tokenInit.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );

    const body = new URLSearchParams(tokenInit.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('redirect_uri')).toBe('https://app.test/cb');
    expect(body.get('client_id')).toBe('aid');
    expect(body.get('client_secret')).toBe('sec');
  });

  it('calls the userinfo endpoint with a Bearer access token', async () => {
    const mock = twoStageFetch({ access_token: 'my-tok' }, meResponse());
    const provider = makeProvider(mock);

    await provider.handleCallback({ code: 'code', redirectUri: 'https://app.test/cb' });

    const [meUrl, meInit] = mock.mock.calls[1] as [string, RequestInit];
    expect(meUrl).toBe('https://tenant.logto.app/oidc/me');
    expect((meInit.headers as Record<string, string>)['Authorization']).toBe('Bearer my-tok');
  });

  it('returns a well-formed AuthenticatedUser on full success', async () => {
    const mock = twoStageFetch({ access_token: 'tok' }, meResponse());
    const provider = makeProvider(mock);

    const user = await provider.handleCallback({ code: 'code', redirectUri: 'https://cb' });

    expect(user).toEqual({
      subject: 'logto-sub-001',
      email: 'user@example.com',
      name: 'Jane Doe',
      provider: 'logto',
    });
  });

  it('sets email to null when userinfo email is absent', async () => {
    const mock = twoStageFetch({ access_token: 'tok' }, meResponse({ email: undefined }));
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.email).toBeNull();
  });

  it('falls back to username when name is absent', async () => {
    const mock = twoStageFetch(
      { access_token: 'tok' },
      meResponse({ name: undefined, username: 'jdoe' }),
    );
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.name).toBe('jdoe');
  });

  it('sets name to null when both name and username are absent', async () => {
    const mock = twoStageFetch(
      { access_token: 'tok' },
      meResponse({ name: undefined, username: undefined }),
    );
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.name).toBeNull();
  });

  it('throws IdentityProviderError when token exchange returns non-ok status', async () => {
    const mock = errFetch(401);
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'bad', redirectUri: 'r' }),
    ).rejects.toThrow(IdentityProviderError);
  });

  it('error message includes the HTTP status on token exchange failure', async () => {
    const mock = errFetch(403);
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'bad', redirectUri: 'r' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('403'),
      provider: 'logto',
    });
  });

  it('throws IdentityProviderError on 5xx token exchange failure', async () => {
    const mock = errFetch(500);
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'code', redirectUri: 'r' }),
    ).rejects.toThrow(IdentityProviderError);
  });

  it('throws IdentityProviderError when token response has no access_token', async () => {
    const mock = okFetch({} /* no access_token */);
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'code', redirectUri: 'r' }),
    ).rejects.toThrow(IdentityProviderError);
  });

  it('error message mentions missing access_token', async () => {
    const mock = okFetch({});
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'code', redirectUri: 'r' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('access_token'),
      provider: 'logto',
    });
  });

  it('throws IdentityProviderError when userinfo returns non-ok status', async () => {
    const mock = twoStageFetch({ access_token: 'tok' }, {}, false, 401);
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'code', redirectUri: 'r' }),
    ).rejects.toThrow(IdentityProviderError);
  });

  it('error message includes userinfo HTTP status', async () => {
    const mock = twoStageFetch({ access_token: 'tok' }, {}, false, 403);
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'code', redirectUri: 'r' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('403'),
      provider: 'logto',
    });
  });

  it('throws IdentityProviderError when userinfo sub is missing', async () => {
    const mock = twoStageFetch({ access_token: 'tok' }, { email: 'no-sub@test.com' });
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'code', redirectUri: 'r' }),
    ).rejects.toThrow(IdentityProviderError);
  });

  it('error message mentions missing sub', async () => {
    const mock = twoStageFetch({ access_token: 'tok' }, {});
    const provider = makeProvider(mock);

    await expect(
      provider.handleCallback({ code: 'code', redirectUri: 'r' }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('sub'),
      provider: 'logto',
    });
  });
});

// ---------------------------------------------------------------------------
// validateSession
// ---------------------------------------------------------------------------

describe('LogtoIdentityProvider.validateSession', () => {
  it('returns { valid: true } with a resolved user on a valid access token', async () => {
    const mock = okFetch(meResponse());
    const provider = makeProvider(mock);

    const result = await provider.validateSession('valid-access-token');

    expect(result.valid).toBe(true);
    expect(result.user).toMatchObject({
      subject: 'logto-sub-001',
      email: 'user@example.com',
      provider: 'logto',
    });
  });

  it('calls the userinfo endpoint with the provided token as a Bearer', async () => {
    const mock = okFetch(meResponse());
    const provider = makeProvider(mock);

    await provider.validateSession('my-session-token');

    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer my-session-token',
    );
  });

  it('returns { valid: false } for an empty-string token without calling fetch', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const result = await provider.validateSession('');

    expect(result.valid).toBe(false);
    expect(mock).not.toHaveBeenCalled();
  });

  it('returns { valid: false, reason } when userinfo returns non-ok status', async () => {
    const mock = errFetch(401);
    const provider = makeProvider(mock);

    const result = await provider.validateSession('expired-token');

    expect(result.valid).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  it('returns { valid: false, reason } when userinfo sub is missing', async () => {
    const mock = okFetch({ email: 'no-sub@test.com' });
    const provider = makeProvider(mock);

    const result = await provider.validateSession('token-without-sub');

    expect(result.valid).toBe(false);
    expect(typeof result.reason).toBe('string');
  });

  it('returns { valid: false, reason } when the fetch rejects (network error)', async () => {
    const mock = jest.fn().mockRejectedValue(new Error('network failure'));
    const provider = makeProvider(mock);

    const result = await provider.validateSession('token');

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('network failure');
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('LogtoIdentityProvider.logout', () => {
  it('returns a URL pointing at the Logto OIDC end-session endpoint', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.logout('https://app.test/after-logout');

    expect(url).toMatch(/^https:\/\/tenant\.logto\.app\/oidc\/session\/end\?/);
  });

  it('includes client_id and post_logout_redirect_uri in the returned URL', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock, { appId: 'my-app' });

    const url = await provider.logout('https://app.test/after-logout');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('client_id')).toBe('my-app');
    expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.test/after-logout',
    );
  });

  it('encodes the redirectUri correctly in the URL', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const redirect = 'https://app.test/done?q=1&r=2';
    const url = await provider.logout(redirect);
    const parsed = new URL(url);

    expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe(redirect);
  });

  it('makes no HTTP calls (pure URL builder)', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    await provider.logout('https://done');

    expect(mock).not.toHaveBeenCalled();
  });

  it('reflects any arbitrary redirectUri value', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const arbitrary = 'https://foo.example.com/done#section';
    const url = await provider.logout(arbitrary);
    const parsed = new URL(url);

    expect(parsed.searchParams.get('post_logout_redirect_uri')).toBe(arbitrary);
  });
});
