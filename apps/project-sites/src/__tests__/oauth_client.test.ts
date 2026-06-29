/**
 * Unit tests for oauth_client — pure OAuth 2.0 token-request builder and
 * token-response parser.
 *
 * Every export in `oauth_client.ts` is a pure function (same inputs → same
 * outputs, no I/O, no env), so none of these tests mock anything external.
 */
import { OAUTH_CONFIGS, buildTokenRequest, parseTokenResponse } from '../services/oauth_client.js';

// ───────────── buildTokenRequest ─────────────

describe('buildTokenRequest', () => {
  const CLIENT_ID = 'client_abc';
  const CLIENT_SECRET = 'secret_xyz';

  it('builds an authorization_code request with code and redirect_uri', () => {
    const { body, headers } = buildTokenRequest({
      grantType: 'authorization_code',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: 'authcode_123',
      redirectUri: 'https://app.example/callback',
    });

    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('authcode_123');
    expect(body.get('redirect_uri')).toBe('https://app.example/callback');
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('client_secret')).toBe(CLIENT_SECRET);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(headers['Accept']).toBe('application/json');
    expect(headers['Authorization']).toBe('Basic Y2xpZW50X2FiYzpzZWNyZXRfeHl6');
  });

  it('builds a client_credentials request with scopes', () => {
    const { body } = buildTokenRequest({
      grantType: 'client_credentials',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      scopes: ['read', 'write'],
    });

    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('read write');
    expect(body.get('code')).toBeNull();
  });

  it('builds a client_credentials request without scopes', () => {
    const { body } = buildTokenRequest({
      grantType: 'client_credentials',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBeNull();
  });

  it('builds a refresh_token request', () => {
    const { body } = buildTokenRequest({
      grantType: 'refresh_token',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      refreshToken: 'rtoken_v2_abc123',
    });

    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rtoken_v2_abc123');
    expect(body.get('code')).toBeNull();
    expect(body.get('redirect_uri')).toBeNull();
  });

  it('does not include optional fields when not provided', () => {
    const { body } = buildTokenRequest({
      grantType: 'client_credentials',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });

    expect(body.get('code')).toBeNull();
    expect(body.get('redirect_uri')).toBeNull();
    expect(body.get('refresh_token')).toBeNull();
    expect(body.get('scope')).toBeNull();
  });

  it('includes scopes only when the array is non-empty', () => {
    const emptyScopes = buildTokenRequest({
      grantType: 'client_credentials',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      scopes: [],
    });

    expect(emptyScopes.body.get('scope')).toBeNull();
  });

  it('always sends client_id and client_secret in the body', () => {
    const { body } = buildTokenRequest({
      grantType: 'refresh_token',
      clientId: 'my_client',
      clientSecret: 'my_secret',
      refreshToken: 'rt_42',
    });

    expect(body.get('client_id')).toBe('my_client');
    expect(body.get('client_secret')).toBe('my_secret');
  });

  it('encodes Basic auth header as base64 of clientId:clientSecret', () => {
    const { headers } = buildTokenRequest({
      grantType: 'authorization_code',
      clientId: 'a',
      clientSecret: 'b',
      code: 'c',
    });

    expect(headers['Authorization']).toBe('Basic YTpi');
  });

  it('returns an empty url string', () => {
    const { url } = buildTokenRequest({
      grantType: 'authorization_code',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: 'x',
    });

    expect(url).toBe('');
  });

  it('does not set code when grant type is not authorization_code', () => {
    const { body } = buildTokenRequest({
      grantType: 'client_credentials',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      // @ts-expect-error — simulating a misconfigured call
      code: 'should_be_ignored',
    });

    expect(body.get('code')).toBeNull();
  });

  it('does not set refresh_token when grant type is not refresh_token', () => {
    const { body } = buildTokenRequest({
      grantType: 'authorization_code',
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      code: 'x',
      // @ts-expect-error — simulating a misconfigured call
      refreshToken: 'should_be_ignored',
    });

    expect(body.get('refresh_token')).toBeNull();
  });
});

// ───────────── parseTokenResponse ─────────────

describe('parseTokenResponse', () => {
  it('parses a complete token response successfully', () => {
    const result = parseTokenResponse({
      access_token: 'ya29.a0Af...',
      refresh_token: '1//0g...',
      expires_in: 3599,
      token_type: 'Bearer',
    });

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('ya29.a0Af...');
    expect(result!.refreshToken).toBe('1//0g...');
    expect(result!.expiresIn).toBe(3599);
    expect(result!.tokenType).toBe('Bearer');
  });

  it('returns null when response contains an error field', () => {
    expect(
      parseTokenResponse({ error: 'invalid_grant', error_description: 'Auth code expired' }),
    ).toBeNull();

    expect(parseTokenResponse({ error: 'invalid_client' })).toBeNull();
  });

  it('returns null when access_token is missing', () => {
    const result = parseTokenResponse({
      refresh_token: '1//0g...',
      expires_in: 3599,
      token_type: 'Bearer',
    });

    expect(result).toBeNull();
  });

  it('returns null when expires_in is missing', () => {
    const result = parseTokenResponse({
      access_token: 'ya29...',
      token_type: 'Bearer',
    });

    expect(result).toBeNull();
  });

  it('returns null when token_type is missing', () => {
    const result = parseTokenResponse({
      access_token: 'ya29...',
      expires_in: 3599,
    });

    expect(result).toBeNull();
  });

  it('returns null when access_token is not a string', () => {
    const result = parseTokenResponse({
      access_token: 12345,
      expires_in: 3599,
      token_type: 'Bearer',
    });

    expect(result).toBeNull();
  });

  it('returns null when expires_in is not a number', () => {
    const result = parseTokenResponse({
      access_token: 'ya29...',
      expires_in: '3600',
      token_type: 'Bearer',
    });

    expect(result).toBeNull();
  });

  it('returns null when token_type is not a string', () => {
    const result = parseTokenResponse({
      access_token: 'ya29...',
      expires_in: 3599,
      token_type: true,
    });

    expect(result).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(parseTokenResponse({})).toBeNull();
  });

  it('sets refreshToken to null when refresh_token is absent', () => {
    const result = parseTokenResponse({
      access_token: 'ya29...',
      expires_in: 3599,
      token_type: 'Bearer',
    });

    expect(result).not.toBeNull();
    expect(result!.refreshToken).toBeNull();
  });

  it('sets refreshToken to null when refresh_token is not a string', () => {
    const result = parseTokenResponse({
      access_token: 'ya29...',
      expires_in: 3599,
      token_type: 'Bearer',
      refresh_token: 42,
    });

    expect(result).not.toBeNull();
    expect(result!.refreshToken).toBeNull();
  });

  it('parses response without a refresh_token (one-legged grant)', () => {
    const result = parseTokenResponse({
      access_token: 'ya29...',
      expires_in: 7200,
      token_type: 'Bearer',
    });

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('ya29...');
    expect(result!.expiresIn).toBe(7200);
    expect(result!.tokenType).toBe('Bearer');
    expect(result!.refreshToken).toBeNull();
  });

  it('handles extended fields without error', () => {
    const result = parseTokenResponse({
      access_token: 'ya29...',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid email',
      id_token: 'eyJ...',
    });

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('ya29...');
  });
});

// ───────────── OAUTH_CONFIGS ─────────────

describe('OAUTH_CONFIGS', () => {
  it('contains exactly the expected provider keys', () => {
    expect(Object.keys(OAUTH_CONFIGS).sort()).toEqual([
      'discord',
      'github',
      'google',
      'linear',
      'notion',
      'slack',
    ]);
  });

  it('every provider has a tokenUrl and a defaultScopes array', () => {
    for (const [slug, cfg] of Object.entries(OAUTH_CONFIGS)) {
      expect(typeof cfg.tokenUrl).toBe('string');
      expect(cfg.tokenUrl.startsWith('https://')).toBe(true);
      expect(Array.isArray(cfg.defaultScopes)).toBe(true);
      expect(cfg.defaultScopes.every((s) => typeof s === 'string')).toBe(true);
    }
  });

  it('google config includes openid, email, and profile scopes', () => {
    const scopes = OAUTH_CONFIGS.google.defaultScopes;
    expect(scopes).toContain('openid');
    expect(scopes).toContain('email');
    expect(scopes).toContain('profile');
  });

  it('github config uses read:user scope', () => {
    expect(OAUTH_CONFIGS.github.defaultScopes).toContain('read:user');
  });

  it('discord config uses identify scope', () => {
    expect(OAUTH_CONFIGS.discord.defaultScopes).toContain('identify');
  });

  it('notion config has an empty default scopes array', () => {
    expect(OAUTH_CONFIGS.notion.defaultScopes).toEqual([]);
  });
});
