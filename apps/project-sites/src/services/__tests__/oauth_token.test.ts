import {
  OAUTH_GRANT_TYPES,
  refreshToken,
  tokenExpiry,
  RefreshTokenError,
  TokenExpiryError,
  type RefreshTokenRequest,
} from '../oauth_token';

// ── OAUTH_GRANT_TYPES ───────────────────────────────────────────────

describe('OAUTH_GRANT_TYPES', () => {
  it('contains all three OAuth 2.0 grant types', () => {
    expect(OAUTH_GRANT_TYPES).toEqual([
      'authorization_code',
      'client_credentials',
      'refresh_token',
    ]);
  });

  it('is a readonly array of length 3', () => {
    expect(OAUTH_GRANT_TYPES).toHaveLength(3);
  });

  it('includes refresh_token', () => {
    expect(OAUTH_GRANT_TYPES.includes('refresh_token')).toBe(true);
  });

  it('includes authorization_code', () => {
    expect(OAUTH_GRANT_TYPES.includes('authorization_code')).toBe(true);
  });

  it('includes client_credentials', () => {
    expect(OAUTH_GRANT_TYPES.includes('client_credentials')).toBe(true);
  });

  it('does not include implicit', () => {
    expect((OAUTH_GRANT_TYPES as readonly string[]).includes('implicit')).toBe(false);
  });

  it('does not include password', () => {
    expect((OAUTH_GRANT_TYPES as readonly string[]).includes('password')).toBe(false);
  });

  it('TypeScript type is OAuthGrantType', () => {
    const check: readonly string[] = OAUTH_GRANT_TYPES;
    expect(check.length).toBeGreaterThan(0);
  });
});

// ── refreshToken ─────────────────────────────────────────────────────

describe('refreshToken', () => {
  it('returns a RefreshTokenRequest with body and headers', () => {
    const req = refreshToken('client-1', 'secret-1', 'rtoken-v1');

    expect(req).toHaveProperty('body');
    expect(req).toHaveProperty('headers');
    expect(req.body).toBeInstanceOf(URLSearchParams);
  });

  it('sets grant_type to refresh_token in body', () => {
    const req = refreshToken('c', 's', 'rt');

    expect(req.body.get('grant_type')).toBe('refresh_token');
  });

  it('includes client_id and client_secret in body', () => {
    const req = refreshToken('my-client', 'my-secret', 'rt');

    expect(req.body.get('client_id')).toBe('my-client');
    expect(req.body.get('client_secret')).toBe('my-secret');
  });

  it('includes refresh_token in body', () => {
    const req = refreshToken('c', 's', 'rtoken-v2-abc');

    expect(req.body.get('refresh_token')).toBe('rtoken-v2-abc');
  });

  it('sets Content-Type to application/x-www-form-urlencoded', () => {
    const req = refreshToken('c', 's', 'rt');

    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('sets Accept to application/json', () => {
    const req = refreshToken('c', 's', 'rt');

    expect(req.headers['Accept']).toBe('application/json');
  });

  it('sets Authorization to Basic base64(clientId:clientSecret)', () => {
    const req = refreshToken('abc', '123', 'rt');

    // base64('abc:123') = 'YWJjOjEyMw=='
    expect(req.headers['Authorization']).toBe('Basic YWJjOjEyMw==');
  });

  it('body can be serialized to a valid form string', () => {
    const req = refreshToken('c', 's', 'rt');
    const str = req.body.toString();

    expect(str).toContain('grant_type=refresh_token');
    expect(str).toContain('client_id=c');
    expect(str).toContain('client_secret=s');
    expect(str).toContain('refresh_token=rt');
  });

  it('body has exactly 4 keys', () => {
    const req = refreshToken('c', 's', 'rt');
    const keys = [...req.body.keys()];

    expect(keys).toHaveLength(4);
    expect(keys.sort()).toEqual(['client_id', 'client_secret', 'grant_type', 'refresh_token']);
  });

  it('throws RefreshTokenError when clientId is empty', () => {
    expect(() => refreshToken('', 's', 'rt')).toThrow(RefreshTokenError);
  });

  it('throws RefreshTokenError when clientSecret is empty', () => {
    expect(() => refreshToken('c', '', 'rt')).toThrow(RefreshTokenError);
  });

  it('throws RefreshTokenError when refreshToken is empty', () => {
    expect(() => refreshToken('c', 's', '')).toThrow(RefreshTokenError);
  });

  it('throws RefreshTokenError with descriptive messages', () => {
    expect(() => refreshToken('', 's', 'rt')).toThrow('clientId is required');
    expect(() => refreshToken('c', '', 'rt')).toThrow('clientSecret is required');
    expect(() => refreshToken('c', 's', '')).toThrow('refreshToken is required');
  });

  it('throws when any parameter is missing (undefined)', () => {
    expect(() => refreshToken(undefined as unknown as string, 's', 'rt')).toThrow(
      RefreshTokenError,
    );

    expect(() => refreshToken('c', undefined as unknown as string, 'rt')).toThrow(
      RefreshTokenError,
    );

    expect(() => refreshToken('c', 's', undefined as unknown as string)).toThrow(RefreshTokenError);
  });

  it('throws when any parameter is null', () => {
    expect(() => refreshToken(null as unknown as string, 's', 'rt')).toThrow(RefreshTokenError);

    expect(() => refreshToken('c', null as unknown as string, 'rt')).toThrow(RefreshTokenError);

    expect(() => refreshToken('c', 's', null as unknown as string)).toThrow(RefreshTokenError);
  });

  it('handles clientId with special characters', () => {
    const req = refreshToken('client@123!', 'secret!', 'rt');
    expect(req.body.get('grant_type')).toBe('refresh_token');
    expect(req.body.get('client_id')).toBe('client@123!');
  });

  it('handles refreshToken value that looks like a URL', () => {
    const req = refreshToken('c', 's', 'https://example.com/rt');
    expect(req.body.get('refresh_token')).toBe('https://example.com/rt');
  });

  it('body toString is properly URL-encoded', () => {
    const req = refreshToken('c', 's', 'rt+/==');
    expect(req.body.toString()).toContain('refresh_token=rt%2B%2F%3D%3D');
  });

  it('return type has mutable body and headers', () => {
    const req: RefreshTokenRequest = refreshToken('c', 's', 'rt');
    expect(typeof req.body.get).toBe('function');
    expect(typeof req.headers['Authorization']).toBe('string');
  });
});

// ── tokenExpiry ──────────────────────────────────────────────────────

describe('tokenExpiry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-29T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a Date', () => {
    const result = tokenExpiry(3600);
    expect(result).toBeInstanceOf(Date);
  });

  it('computes expiry correctly for 1 hour (3600s)', () => {
    const result = tokenExpiry(3600);
    expect(result.toISOString()).toBe('2026-06-29T13:00:00.000Z');
  });

  it('computes expiry correctly for 30 minutes (1800s)', () => {
    const result = tokenExpiry(1800);
    expect(result.toISOString()).toBe('2026-06-29T12:30:00.000Z');
  });

  it('computes expiry correctly for 0 seconds', () => {
    const result = tokenExpiry(0);
    expect(result.toISOString()).toBe('2026-06-29T12:00:00.000Z');
  });

  it('computes expiry correctly for a fractional value (0.5s)', () => {
    const result = tokenExpiry(0.5);
    // 500ms later
    expect(result.toISOString()).toBe('2026-06-29T12:00:00.500Z');
  });

  it('rounds fractional expiresIn to the nearest millisecond', () => {
    const result = tokenExpiry(0.0015);
    // 1.5ms rounds to 2ms
    expect(result.getTime()).toBe(new Date('2026-06-29T12:00:00.002Z').getTime());
  });

  it('handles large values (1 year in seconds)', () => {
    // 1 year = 31,536,000 seconds
    const result = tokenExpiry(31536000);
    expect(result.getFullYear()).toBe(2027);
  });

  it('throws TokenExpiryError when expiresIn is negative', () => {
    expect(() => tokenExpiry(-1)).toThrow(TokenExpiryError);
    expect(() => tokenExpiry(-1)).toThrow('expiresIn must be non-negative');
  });

  it('throws TokenExpiryError when expiresIn is NaN', () => {
    expect(() => tokenExpiry(NaN)).toThrow(TokenExpiryError);
  });

  it('throws TokenExpiryError when expiresIn is Infinity', () => {
    expect(() => tokenExpiry(Infinity)).toThrow(TokenExpiryError);
  });

  it('throws TokenExpiryError when expiresIn is -Infinity', () => {
    expect(() => tokenExpiry(-Infinity)).toThrow(TokenExpiryError);
  });

  it('throws TokenExpiryError when expiresIn is a string', () => {
    expect(() => tokenExpiry('3600' as unknown as number)).toThrow(TokenExpiryError);
  });

  it('throws TokenExpiryError when expiresIn is null', () => {
    expect(() => tokenExpiry(null as unknown as number)).toThrow(TokenExpiryError);
  });

  it('throws TokenExpiryError when expiresIn is undefined', () => {
    expect(() => tokenExpiry(undefined as unknown as number)).toThrow(TokenExpiryError);
  });

  it('throws TokenExpiryError when expiresIn is an object', () => {
    expect(() => tokenExpiry({} as unknown as number)).toThrow(TokenExpiryError);
  });
});

// ── Type-level checks ────────────────────────────────────────────────

describe('TypeScript type coverage', () => {
  it('OAUTH_GRANT_TYPES is readonly OAuthGrantType[]', () => {
    const types: readonly string[] = OAUTH_GRANT_TYPES;
    expect(Array.isArray(types)).toBe(true);
  });

  it('refreshToken returns RefreshTokenRequest', () => {
    const req: RefreshTokenRequest = refreshToken('a', 'b', 'c');
    expect(req.body).toBeInstanceOf(URLSearchParams);
  });

  it('tokenExpiry returns Date', () => {
    const d: Date = tokenExpiry(1);
    expect(d).toBeInstanceOf(Date);
  });

  it('RefreshTokenError is instanceof Error', () => {
    const err = new RefreshTokenError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RefreshTokenError');
  });

  it('TokenExpiryError is instanceof Error', () => {
    const err = new TokenExpiryError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TokenExpiryError');
  });
});
