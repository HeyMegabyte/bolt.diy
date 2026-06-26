/**
 * Unit tests for WorkOsEnterpriseIdentityProvider.
 *
 * Pick note: external_llm_provider_tiers.test.ts already covers chooseProviderForTier
 * exhaustively (9 tests, all branches). retry.test.ts covers classifyError/withRetry
 * completely (235 lines). This file instead targets workos_provider.ts — zero existing
 * coverage, injectable fetchImpl allows testing with no jest.mock().
 */

import { WorkOsEnterpriseIdentityProvider } from '../services/workos_provider.js';
import { IdentityProviderError } from '../platform/identity.js';
import type { WorkOsConfig } from '../services/workos_provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal WorkOsConfig with an injectable fetch mock. */
function makeProvider(fetchImpl: jest.Mock, overrides?: Partial<WorkOsConfig>) {
  return new WorkOsEnterpriseIdentityProvider({
    apiKey: 'test-api-key',
    clientId: 'test-client-id',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  });
}

/** Minimal successful token exchange response body. */
function profileResponse(overrides: Record<string, unknown> = {}) {
  return {
    profile: {
      id: 'workos-sub-001',
      email: 'user@example.com',
      first_name: 'Jane',
      last_name: 'Doe',
      organization_id: 'org-abc',
      ...overrides,
    },
  };
}

/** Build a mock fetch that returns an ok JSON response. */
function okFetch(body: unknown, status = 200): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: true,
    status,
    json: () => Promise.resolve(body),
  });
  return mock;
}

/** Build a mock fetch that returns a non-ok response. */
function errFetch(status: number): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'bad' }),
  });
}

// ---------------------------------------------------------------------------
// createLoginUrl
// ---------------------------------------------------------------------------

describe('WorkOsEnterpriseIdentityProvider.createLoginUrl', () => {
  it('returns a URL pointing at the WorkOS SSO authorize endpoint', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'csrf-state-123',
    });

    expect(url).toMatch(/^https:\/\/api\.workos\.com\/sso\/authorize\?/);
  });

  it('includes required query params: client_id, redirect_uri, response_type, state', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock, { clientId: 'my-client' });

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'my-state',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('my-client');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.test/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('state')).toBe('my-state');
  });

  it('does NOT include organization param when organizationId is absent', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'state',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.has('organization')).toBe(false);
  });

  it('does NOT include organization param when organizationId is null', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'state',
      organizationId: null,
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.has('organization')).toBe(false);
  });

  it('includes organization param when organizationId is provided', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const url = await provider.createLoginUrl({
      redirectUri: 'https://app.test/callback',
      state: 'state',
      organizationId: 'org-enterprise-xyz',
    });

    const parsed = new URL(url);
    expect(parsed.searchParams.get('organization')).toBe('org-enterprise-xyz');
  });

  it('makes no HTTP calls (pure URL builder)', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);
    await provider.createLoginUrl({ redirectUri: 'https://x.test', state: 's' });
    expect(mock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleCallback
// ---------------------------------------------------------------------------

describe('WorkOsEnterpriseIdentityProvider.handleCallback', () => {
  it('calls the WorkOS /sso/token endpoint with correct params', async () => {
    const mock = okFetch(profileResponse());
    const provider = makeProvider(mock, { apiKey: 'sk-key', clientId: 'cid' });

    await provider.handleCallback({ code: 'auth-code-abc', redirectUri: 'https://app.test/cb' });

    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.workos.com/sso/token');
    expect(init.method).toBe('POST');

    const body = new URLSearchParams(init.body as string);
    expect(body.get('client_id')).toBe('cid');
    expect(body.get('client_secret')).toBe('sk-key');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-abc');
  });

  it('returns a well-formed AuthenticatedUser on success', async () => {
    const mock = okFetch(profileResponse());
    const provider = makeProvider(mock);

    const user = await provider.handleCallback({ code: 'code', redirectUri: 'https://cb' });

    expect(user).toEqual({
      subject: 'workos-sub-001',
      email: 'user@example.com',
      name: 'Jane Doe',
      provider: 'workos',
      organizationId: 'org-abc',
    });
  });

  it('assembles name from first_name + last_name', async () => {
    const mock = okFetch(profileResponse({ first_name: 'Alice', last_name: 'Smith' }));
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.name).toBe('Alice Smith');
  });

  it('uses first_name alone when last_name is absent', async () => {
    const mock = okFetch(profileResponse({ last_name: undefined }));
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.name).toBe('Jane');
  });

  it('uses last_name alone when first_name is absent', async () => {
    const mock = okFetch(profileResponse({ first_name: undefined, last_name: 'Doe' }));
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.name).toBe('Doe');
  });

  it('sets name to null when both first_name and last_name are absent', async () => {
    const mock = okFetch(profileResponse({ first_name: undefined, last_name: undefined }));
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.name).toBeNull();
  });

  it('sets email to null when profile email is absent', async () => {
    const mock = okFetch(profileResponse({ email: undefined }));
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.email).toBeNull();
  });

  it('sets organizationId to null when profile organization_id is absent', async () => {
    const mock = okFetch(profileResponse({ organization_id: undefined }));
    const user = await makeProvider(mock).handleCallback({ code: 'c', redirectUri: 'r' });
    expect(user.organizationId).toBeNull();
  });

  it('throws IdentityProviderError when token exchange returns non-ok status', async () => {
    const mock = errFetch(401);
    const provider = makeProvider(mock);

    await expect(provider.handleCallback({ code: 'bad', redirectUri: 'r' })).rejects.toThrow(
      IdentityProviderError,
    );
  });

  it('error includes the HTTP status in the message', async () => {
    const mock = errFetch(403);
    const provider = makeProvider(mock);

    await expect(provider.handleCallback({ code: 'bad', redirectUri: 'r' })).rejects.toMatchObject({
      message: expect.stringContaining('403'),
      provider: 'workos',
    });
  });

  it('throws IdentityProviderError when profile.id is missing in response', async () => {
    const mock = okFetch({ profile: { email: 'no-id@example.com' } });
    const provider = makeProvider(mock);

    await expect(provider.handleCallback({ code: 'code', redirectUri: 'r' })).rejects.toThrow(
      IdentityProviderError,
    );
  });

  it('throws IdentityProviderError when profile is missing entirely', async () => {
    const mock = okFetch({});
    const provider = makeProvider(mock);

    await expect(provider.handleCallback({ code: 'code', redirectUri: 'r' })).rejects.toThrow(
      IdentityProviderError,
    );
  });

  it('throws IdentityProviderError on 5xx', async () => {
    const mock = errFetch(500);
    const provider = makeProvider(mock);

    await expect(provider.handleCallback({ code: 'code', redirectUri: 'r' })).rejects.toThrow(
      IdentityProviderError,
    );
  });
});

// ---------------------------------------------------------------------------
// validateSession
// ---------------------------------------------------------------------------

describe('WorkOsEnterpriseIdentityProvider.validateSession', () => {
  it('always returns { valid: false } regardless of token value', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const result = await provider.validateSession('any-token-here');

    expect(result.valid).toBe(false);
  });

  it('returns the expected reason string', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const result = await provider.validateSession('some-jwt');

    expect(result.reason).toBe('workos: validate via the issued D1 session');
  });

  it('makes no HTTP calls (deterministic, no side effects)', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    await provider.validateSession('token');

    expect(mock).not.toHaveBeenCalled();
  });

  it('returns { valid: false } for an empty string token too', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const result = await provider.validateSession('');

    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('WorkOsEnterpriseIdentityProvider.logout', () => {
  it('returns the redirectUri unchanged (pure passthrough)', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const result = await provider.logout('https://app.test/after-logout');

    expect(result).toBe('https://app.test/after-logout');
  });

  it('passes any arbitrary URI through without modification', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    const arbitrary = 'https://foo.example.com/done?q=1&r=2#section';
    const result = await provider.logout(arbitrary);

    expect(result).toBe(arbitrary);
  });

  it('makes no HTTP calls', async () => {
    const mock = jest.fn();
    const provider = makeProvider(mock);

    await provider.logout('https://done');

    expect(mock).not.toHaveBeenCalled();
  });
});
