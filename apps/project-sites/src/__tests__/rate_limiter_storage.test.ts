/**
 * rate_limiter_storage — pure serialization round-trip for token-bucket state.
 *
 * Every function is synchronous, pure, and side-effect-free — no mocks needed.
 */
import {
  snapshot,
  fromSnapshot,
  serializeSnapshots,
  deserializeSnapshots,
} from '../services/rate_limiter_storage.js';
import type { RateLimitSnapshot } from '../services/rate_limiter_storage.js';

const T0 = 1_714_000_000_000;

describe('snapshot', () => {
  it('creates a RateLimitSnapshot with all fields', () => {
    const s = snapshot('user:42', 5, T0, 60_000, 10);
    expect(s).toEqual({
      key: 'user:42',
      tokens: 5,
      lastRefillMs: T0,
      windowMs: 60_000,
      maxTokens: 10,
    });
  });

  it('accepts fractional tokens', () => {
    const s = snapshot('ip:1.2.3.4', 3.7, T0, 1_000, 5);
    expect(s.tokens).toBe(3.7);
  });

  it('accepts zero tokens (exhausted bucket)', () => {
    const s = snapshot('ip:1.2.3.4', 0, T0, 1_000, 5);
    expect(s.tokens).toBe(0);
  });
});

describe('fromSnapshot', () => {
  it('extracts mutable fields, dropping the key', () => {
    const s = snapshot('user:99', 8, T0, 30_000, 15);
    const { tokens, lastRefillMs, windowMs, maxTokens } = fromSnapshot(s);
    expect({ tokens, lastRefillMs, windowMs, maxTokens }).toEqual({
      tokens: 8,
      lastRefillMs: T0,
      windowMs: 30_000,
      maxTokens: 15,
    });
  });

  it('does not mutate the original snapshot', () => {
    const s: RateLimitSnapshot = {
      key: 'ip:5.6.7.8',
      tokens: 2,
      lastRefillMs: T0,
      windowMs: 10_000,
      maxTokens: 5,
    };
    const original = { ...s };
    fromSnapshot(s);
    expect(s).toEqual(original);
  });
});

describe('serializeSnapshots', () => {
  it('produces valid compact JSON for a single snapshot', () => {
    const s = snapshot('k', 1, T0, 60_000, 5);
    const json = serializeSnapshots([s]);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(s);
  });

  it('produces valid JSON for multiple snapshots', () => {
    const a = snapshot('a', 3, T0, 60_000, 10);
    const b = snapshot('b', 0, T0, 30_000, 5);
    const json = serializeSnapshots([a, b]);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].key).toBe('a');
    expect(parsed[1].key).toBe('b');
  });

  it('returns "[]" for an empty array', () => {
    expect(serializeSnapshots([])).toBe('[]');
  });

  it('does not include extra whitespace (compact)', () => {
    const s = snapshot('x', 1, T0, 60_000, 5);
    const json = serializeSnapshots([s]);
    expect(json).not.toContain(' ');
  });

  it('round-trips a frozen snapshot array', () => {
    const s = snapshot('z', 4, T0, 60_000, 10);
    const json = serializeSnapshots(Object.freeze([s]));
    expect(JSON.parse(json)[0].tokens).toBe(4);
  });
});

describe('deserializeSnapshots', () => {
  it('round-trips a single snapshot', () => {
    const original = [snapshot('k', 1, T0, 60_000, 5)];
    const json = serializeSnapshots(original);
    const restored = deserializeSnapshots(json);
    expect(restored).toEqual(original);
  });

  it('round-trips multiple snapshots', () => {
    const original = [
      snapshot('a', 3, T0, 60_000, 10),
      snapshot('b', 0, T0, 30_000, 5),
      snapshot('c', 7.5, T0, 120_000, 20),
    ];
    const json = serializeSnapshots(original);
    const restored = deserializeSnapshots(json);
    expect(restored).toEqual(original);
  });

  it('round-trips an empty array', () => {
    expect(deserializeSnapshots('[]')).toEqual([]);
  });

  it('round-trips keys with special characters', () => {
    const original = [
      snapshot('user:email+test@example.com', 10, T0, 60_000, 15),
      snapshot('org:my-org_slug/1', 5, T0, 30_000, 10),
    ];
    const json = serializeSnapshots(original);
    expect(deserializeSnapshots(json)).toEqual(original);
  });

  it('throws SyntaxError on malformed JSON', () => {
    expect(() => deserializeSnapshots('not-json')).toThrow(SyntaxError);
  });

  it('throws SyntaxError when the root is not an array', () => {
    expect(() => deserializeSnapshots('"string"')).toThrow(SyntaxError);
    expect(() => deserializeSnapshots('42')).toThrow(SyntaxError);
    expect(() => deserializeSnapshots('{}')).toThrow(SyntaxError);
    expect(() => deserializeSnapshots('null')).toThrow(SyntaxError);
  });
});

describe('full round-trip (serialize → deserialize → fromSnapshot)', () => {
  it('survives a full persistence cycle', () => {
    const original = [
      snapshot('ip:10.0.0.1', 8, T0 + 1000, 60_000, 10),
      snapshot('user:admin', 3, T0 + 2000, 30_000, 5),
      snapshot('api:stripe', 99, T0 + 3000, 3_600_000, 100),
    ];

    // Store
    const json = serializeSnapshots(original);
    expect(typeof json).toBe('string');

    // Retrieve
    const restored = deserializeSnapshots(json);
    expect(restored).toHaveLength(original.length);

    // Use
    for (let i = 0; i < restored.length; i++) {
      const { tokens, lastRefillMs, windowMs, maxTokens } = fromSnapshot(restored[i]);
      expect(tokens).toBe(original[i].tokens);
      expect(lastRefillMs).toBe(original[i].lastRefillMs);
      expect(windowMs).toBe(original[i].windowMs);
      expect(maxTokens).toBe(original[i].maxTokens);
    }
  });
});
