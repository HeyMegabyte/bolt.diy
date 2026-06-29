import {
  createToken,
  isExpired,
  hasScope,
  type ApiToken,
  type TokenScope,
} from '../services/api_token.js';

describe('createToken', () => {
  it('creates a token with default nowMs (Date.now)', () => {
    const before = Date.now();
    const token = createToken('deploy key', ['write'], null);
    const after = Date.now();
    expect(token.id).toBeTruthy();
    expect(token.name).toBe('deploy key');
    expect(token.scopes).toEqual(['write']);
    expect(token.createdAt).toBeGreaterThanOrEqual(before);
    expect(token.createdAt).toBeLessThanOrEqual(after);
    expect(token.expiresAt).toBeNull();
    expect(token.lastUsedAt).toBeNull();
  });

  it('sets expiresAt when ttlMs is given', () => {
    const now = 1_000_000_000_000;
    const token = createToken('ephemeral', ['read'], 86_400_000, now);
    expect(token.createdAt).toBe(now);
    expect(token.expiresAt).toBe(now + 86_400_000);
  });

  it('creates a non-expiring token when ttlMs is null', () => {
    const token = createToken('permanent', ['admin'], null, 1_000_000);
    expect(token.expiresAt).toBeNull();
  });

  it('creates a non-expiring token when ttlMs is undefined', () => {
    const token = createToken('permanent', ['admin'], undefined, 1_000_000);
    expect(token.expiresAt).toBeNull();
  });

  it('copies scopes array (defensive copy)', () => {
    const scopes: TokenScope[] = ['read'];
    const token = createToken('test', scopes, null, 1_000_000);
    scopes.push('admin');
    expect(token.scopes).toEqual(['read']);
  });

  it('throws on empty scopes', () => {
    expect(() => createToken('bad', [], null, 1_000_000)).toThrow(RangeError);
    expect(() => createToken('bad', [], null, 1_000_000)).toThrow('At least one scope is required');
  });

  it('throws on zero ttlMs', () => {
    expect(() => createToken('bad', ['read'], 0, 1_000_000)).toThrow(RangeError);
  });

  it('throws on negative ttlMs', () => {
    expect(() => createToken('bad', ['read'], -1000, 1_000_000)).toThrow(RangeError);
  });

  it('generates a UUID-like id', () => {
    const token = createToken('t', ['read'], null, 1_000_000);
    expect(token.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('isExpired', () => {
  function token(expiresAt: number | null, over: Partial<ApiToken> = {}): ApiToken {
    return {
      id: 'id',
      name: 't',
      scopes: ['read'],
      createdAt: 1_000_000,
      expiresAt,
      lastUsedAt: null,
      ...over,
    };
  }

  it('returns false for non-expiring token', () => {
    expect(isExpired(token(null), 2_000_000)).toBe(false);
  });

  it('returns false when expiry is in the future', () => {
    expect(isExpired(token(2_000_000), 1_000_000)).toBe(false);
  });

  it('returns true when expiry is in the past', () => {
    expect(isExpired(token(1_000_000), 2_000_000)).toBe(true);
  });

  it('returns true when expiry equals nowMs (boundary)', () => {
    expect(isExpired(token(1_000_000), 1_000_000)).toBe(true);
  });

  it('uses Date.now() when nowMs is omitted', () => {
    const future = Date.now() + 86_400_000;
    expect(isExpired(token(future))).toBe(false);
  });
});

describe('hasScope', () => {
  function token(scopes: TokenScope[]): ApiToken {
    return {
      id: 'id',
      name: 't',
      scopes,
      createdAt: 1_000_000,
      expiresAt: null,
      lastUsedAt: null,
    };
  }

  describe('exact match', () => {
    it('read token has read scope', () => {
      expect(hasScope(token(['read']), 'read')).toBe(true);
    });

    it('read token does NOT have write scope', () => {
      expect(hasScope(token(['read']), 'write')).toBe(false);
    });

    it('read token does NOT have admin scope', () => {
      expect(hasScope(token(['read']), 'admin')).toBe(false);
    });

    it('write token has write scope', () => {
      expect(hasScope(token(['write']), 'write')).toBe(true);
    });

    it('admin token has admin scope', () => {
      expect(hasScope(token(['admin']), 'admin')).toBe(true);
    });
  });

  describe('implicit hierarchy', () => {
    it('admin grants write', () => {
      expect(hasScope(token(['admin']), 'write')).toBe(true);
    });

    it('admin grants read', () => {
      expect(hasScope(token(['admin']), 'read')).toBe(true);
    });

    it('write grants read', () => {
      expect(hasScope(token(['write']), 'read')).toBe(true);
    });
  });

  describe('multiple scopes', () => {
    it('read+write token has read', () => {
      expect(hasScope(token(['read', 'write']), 'read')).toBe(true);
    });

    it('read+write token has write', () => {
      expect(hasScope(token(['read', 'write']), 'write')).toBe(true);
    });

    it('read+write token does NOT have admin', () => {
      expect(hasScope(token(['read', 'write']), 'admin')).toBe(false);
    });
  });

  describe('empty scopes', () => {
    it('no scope can be fulfilled', () => {
      expect(hasScope(token([]), 'read')).toBe(false);
      expect(hasScope(token([]), 'write')).toBe(false);
      expect(hasScope(token([]), 'admin')).toBe(false);
    });
  });
});
