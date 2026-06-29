/**
 * Short-lived client token issuer. Pure — no I/O, no clock dependency
 * when `nowMs` is provided. Covers minting, expiry, payload extraction,
 * scope immutability, and default TTL.
 */
import { mintToken, isExpired, tokenPayload, DEFAULT_TTL_MS } from '../services/client_token.js';
import type { ClientToken } from '../services/client_token.js';

describe('client token', () => {
  const NOW = 1_719_500_000_000;

  describe('mintToken', () => {
    it('returns a ClientToken with all fields populated', () => {
      const tok = mintToken('site-abc', 'user-42', ['editor:write'], DEFAULT_TTL_MS, NOW);

      expect(tok.token).toBeDefined();
      expect(typeof tok.token).toBe('string');
      // UUID-like shape: 36 chars, 4 hyphens, hex digits
      expect(tok.token).toMatch(/^[0-9a-f-]{36}$/);

      expect(tok.siteId).toBe('site-abc');
      expect(tok.userId).toBe('user-42');
      expect(tok.scope).toEqual(['editor:write']);
      expect(tok.expiresAt).toBe(NOW + DEFAULT_TTL_MS);
    });

    it('is deterministic when nowMs is fixed (except the random token)', () => {
      const tok1 = mintToken('s', 'u', ['r'], 1000, NOW);
      const tok2 = mintToken('s', 'u', ['r'], 1000, NOW);

      expect(tok1.token).not.toBe(tok2.token); // random UUID per call
      expect(tok1.expiresAt).toBe(tok2.expiresAt);
      expect(tok1.siteId).toBe(tok2.siteId);
      expect(tok1.userId).toBe(tok2.userId);
      expect(tok1.scope).toEqual(tok2.scope);
    });

    it('copies the scope array (does not share reference)', () => {
      const original = ['read', 'write'];
      const tok = mintToken('s', 'u', original, 1000, NOW);

      original.push('admin'); // mutate original

      expect(tok.scope).toEqual(['read', 'write']);
    });

    it('defaults ttlMs to DEFAULT_TTL_MS', () => {
      const tok = mintToken('s', 'u', []);
      expect(tok.expiresAt).toBeGreaterThanOrEqual(Date.now() + DEFAULT_TTL_MS - 50);
      expect(tok.expiresAt).toBeLessThanOrEqual(Date.now() + DEFAULT_TTL_MS + 50);
    });

    it('defaults nowMs to Date.now() when omitted', () => {
      const before = Date.now();
      const tok = mintToken('s', 'u', []);
      const after = Date.now();

      expect(tok.expiresAt).toBeGreaterThanOrEqual(before + DEFAULT_TTL_MS);
      expect(tok.expiresAt).toBeLessThanOrEqual(after + DEFAULT_TTL_MS);
    });

    it('generates a unique token per call', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(mintToken('s', 'u', []).token);
      }
      expect(tokens.size).toBe(100);
    });

    it('handles empty scope array', () => {
      const tok = mintToken('s', 'u', [], 1000, NOW);
      expect(tok.scope).toEqual([]);
    });

    it('handles multiple scope entries', () => {
      const tok = mintToken('s', 'u', ['a', 'b', 'c'], 1000, NOW);
      expect(tok.scope).toEqual(['a', 'b', 'c']);
    });
  });

  describe('isExpired', () => {
    const ACTIVE: ClientToken = {
      token: 'tok-1',
      expiresAt: NOW + 60_000,
      scope: [],
      siteId: 's',
      userId: 'u',
    };

    it('returns false when nowMs is before expiry', () => {
      expect(isExpired(ACTIVE, ACTIVE.expiresAt - 1)).toBe(false);
    });

    it('returns true when nowMs equals expiry', () => {
      expect(isExpired(ACTIVE, ACTIVE.expiresAt)).toBe(true);
    });

    it('returns true when nowMs is after expiry', () => {
      expect(isExpired(ACTIVE, ACTIVE.expiresAt + 1)).toBe(true);
    });

    it('returns false for a freshly-minted token', () => {
      const tok = mintToken('s', 'u', [], 5000, NOW);
      expect(isExpired(tok, NOW)).toBe(false);
      expect(isExpired(tok, NOW + 4999)).toBe(false);
    });

    it('returns true for a fully-expired token', () => {
      const tok = mintToken('s', 'u', [], 5000, NOW);
      expect(isExpired(tok, NOW + 5000)).toBe(true);
      expect(isExpired(tok, NOW + 10_000)).toBe(true);
    });

    it('defaults nowMs to Date.now()', () => {
      const tok = mintToken('s', 'u', [], 1_000_000_000);
      expect(isExpired(tok)).toBe(false); // 11+ days TTL, never expired mid-test
    });
  });

  describe('tokenPayload', () => {
    it('returns siteId, userId, scope, and exp', () => {
      const tok = mintToken('site-x', 'user-7', ['scope:admin'], 1000, NOW);
      const payload = tokenPayload(tok);

      expect(payload).toEqual({
        siteId: 'site-x',
        userId: 'user-7',
        scope: ['scope:admin'],
        exp: NOW + 1000,
      });
    });

    it('returns a plain object (not a frozen reference)', () => {
      const tok = mintToken('s', 'u', ['r'], 1000, NOW);
      const payload = tokenPayload(tok);

      // Mutating the payload must NOT affect the original token
      (payload as Record<string, unknown>).siteId = 'hacked';

      expect(tok.siteId).toBe('s');
    });

    it('includes scope array reference (not a deep clone — documented)', () => {
      const tok = mintToken('s', 'u', ['read'], 1000, NOW);
      const payload = tokenPayload(tok);
      expect(payload.scope).toBe(tok.scope); // same reference
    });
  });

  describe('DEFAULT_TTL_MS', () => {
    it('is 300 000 (5 minutes)', () => {
      expect(DEFAULT_TTL_MS).toBe(300_000);
    });
  });
});
