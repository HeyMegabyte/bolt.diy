/**
 * Tests for the listmonk_retry service module.
 *
 * All tests are pure — no I/O, no Math.random, no real Date.now(). Every
 * function is called with explicit timestamps for deterministic results.
 */

import {
  LISTMONK_RETRY,
  retryDelay,
  idempotencyKey,
  consumeToken,
  refillTokens,
} from '../services/listmonk_retry.js';
import type { TokenBucket } from '../services/listmonk_retry.js';

// ---------------------------------------------------------------------------
// LISTMONK_RETRY
// ---------------------------------------------------------------------------

describe('LISTMONK_RETRY', () => {
  it('has the expected default values', () => {
    expect(LISTMONK_RETRY.maxRetries).toBe(3);
    expect(LISTMONK_RETRY.baseDelayMs).toBe(1000);
    expect(LISTMONK_RETRY.maxDelayMs).toBe(30000);
    expect(LISTMONK_RETRY.jitter).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// retryDelay
// ---------------------------------------------------------------------------

describe('retryDelay', () => {
  it('produces exponential growth for attempts 0-4 with default config', () => {
    const delays = [0, 1, 2, 3, 4].map((a) => retryDelay(a));
    // With jitter on, each is clamped so we just assert the ordering
    const inOrder = delays.every((d, i) => i === 0 || d >= delays[i - 1]);
    expect(inOrder).toBe(true);
    // All should be within [500, 30000] with default config
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(30000);
    }
  });

  it('grows exponentially without jitter', () => {
    const cfg = { ...LISTMONK_RETRY, jitter: false };
    expect(retryDelay(0, cfg)).toBe(1000);
    expect(retryDelay(1, cfg)).toBe(2000);
    expect(retryDelay(2, cfg)).toBe(4000);
    expect(retryDelay(3, cfg)).toBe(8000);
    expect(retryDelay(4, cfg)).toBe(16000);
  });

  it('caps at maxDelayMs', () => {
    const cfg = { ...LISTMONK_RETRY, jitter: false, baseDelayMs: 1000, maxDelayMs: 5000 };
    // attempt 3: base * 2^3 = 8000 → capped to 5000
    expect(retryDelay(3, cfg)).toBe(5000);
    // attempt 10: base * 2^10 = 1024000 → capped to 5000
    expect(retryDelay(10, cfg)).toBe(5000);
  });

  it('is deterministic — same attempt and config produce the same delay', () => {
    const a = retryDelay(2, LISTMONK_RETRY);
    const b = retryDelay(2, LISTMONK_RETRY);
    expect(a).toBe(b);
  });

  it('produces different jitter factors for different attempt numbers', () => {
    const cfg = { ...LISTMONK_RETRY, jitter: true, baseDelayMs: 10000, maxDelayMs: 100000 };
    const d0 = retryDelay(0, cfg);
    const d1 = retryDelay(1, cfg);
    // Without jitter: 10000, 20000. With jitter both should differ from
    // their base.
    expect(d0).not.toBe(10000);
    expect(d1).not.toBe(20000);
  });

  it('uses LISTMONK_RETRY as the default config', () => {
    // Spot-check — calling with no config matches calling with LISTMONK_RETRY
    // and jitter disabled (so we can check the raw value).
    const noJitter = { ...LISTMONK_RETRY, jitter: false };
    expect(retryDelay(0)).toBeGreaterThanOrEqual(retryDelay(0, noJitter) * 0.5);
    expect(retryDelay(0)).toBeLessThanOrEqual(retryDelay(0, noJitter) * 1.5);
  });
});

// ---------------------------------------------------------------------------
// idempotencyKey
// ---------------------------------------------------------------------------

describe('idempotencyKey', () => {
  it('produces the expected format with a string email', () => {
    const key = idempotencyKey('upsertSubscriber', 'user@example.com', 1719400000000);
    expect(key).toBe('upsertSubscriber_user@example.com_1719400000000');
  });

  it('produces the expected format with a numeric id', () => {
    const key = idempotencyKey('deleteSubscriber', 42, 1719400000000);
    expect(key).toBe('deleteSubscriber_42_1719400000000');
  });

  it('produces the same key for the same inputs', () => {
    const a = idempotencyKey('upsert', 'a@b.com', 1000);
    const b = idempotencyKey('upsert', 'a@b.com', 1000);
    expect(a).toBe(b);
  });

  it('produces different keys for different timestamps', () => {
    const a = idempotencyKey('upsert', 'a@b.com', 1000);
    const b = idempotencyKey('upsert', 'a@b.com', 2000);
    expect(a).not.toBe(b);
  });

  it('produces different keys for different operations', () => {
    const a = idempotencyKey('upsert', 'a@b.com', 1000);
    const b = idempotencyKey('delete', 'a@b.com', 1000);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// TokenBucket — consumeToken
// ---------------------------------------------------------------------------

describe('consumeToken', () => {
  const fullBucket: TokenBucket = {
    tokens: 5,
    lastRefillMs: 0,
    maxTokens: 10,
    refillRatePerSecond: 2,
  };

  it('allows the call when tokens are available', () => {
    const { allowed, bucket } = consumeToken(fullBucket, 100);
    expect(allowed).toBe(true);
    // Refill adds 0.2 tokens (100ms at 2/s), then consume subtracts 1.
    expect(bucket.tokens).toBeCloseTo(4.2, 5);
    expect(bucket.lastRefillMs).toBe(100);
  });

  it('blocks the call when tokens are empty and no time has elapsed', () => {
    const empty: TokenBucket = {
      tokens: 0,
      lastRefillMs: 0,
      maxTokens: 10,
      refillRatePerSecond: 2,
    };
    const { allowed, bucket } = consumeToken(empty, 0);
    expect(allowed).toBe(false);
    expect(bucket.tokens).toBe(0);
  });

  it('refills then allows when enough time has elapsed', () => {
    const empty: TokenBucket = {
      tokens: 0,
      lastRefillMs: 0,
      maxTokens: 10,
      refillRatePerSecond: 2,
    };
    // 2 seconds elapsed → 4 tokens refilled
    const { allowed, bucket } = consumeToken(empty, 2000);
    expect(allowed).toBe(true);
    expect(bucket.tokens).toBe(3); // consumed 1 after refill
    expect(bucket.lastRefillMs).toBe(2000);
  });

  it('never returns a negative token count', () => {
    const empty: TokenBucket = {
      tokens: 0,
      lastRefillMs: 0,
      maxTokens: 10,
      refillRatePerSecond: 0,
    };
    const { allowed, bucket } = consumeToken(empty, 5000);
    expect(allowed).toBe(false);
    expect(bucket.tokens).toBe(0);
  });

  it('returns the bucket unchanged on block (refill rate 0, no time)', () => {
    const empty: TokenBucket = {
      tokens: 0,
      lastRefillMs: 100,
      maxTokens: 10,
      refillRatePerSecond: 0,
    };
    const { allowed, bucket } = consumeToken(empty, 100);
    expect(allowed).toBe(false);
    expect(bucket.tokens).toBe(0);
    expect(bucket.lastRefillMs).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// TokenBucket — refillTokens
// ---------------------------------------------------------------------------

describe('refillTokens', () => {
  const bucket: TokenBucket = {
    tokens: 3,
    lastRefillMs: 0,
    maxTokens: 10,
    refillRatePerSecond: 2,
  };

  it('adds tokens based on elapsed time (capped at max)', () => {
    const result = refillTokens(bucket, 5000); // 5 seconds → 3 + 10 = 13, capped at 10
    expect(result.tokens).toBe(10);
    expect(result.lastRefillMs).toBe(5000);
  });

  it('caps at maxTokens', () => {
    const nearlyFull: TokenBucket = {
      tokens: 9,
      lastRefillMs: 0,
      maxTokens: 10,
      refillRatePerSecond: 5,
    };
    const result = refillTokens(nearlyFull, 1000);
    expect(result.tokens).toBe(10); // 9 + 5 = 14, capped at 10
  });

  it('adds fractional tokens for sub-second intervals', () => {
    const result = refillTokens(bucket, 500); // 0.5 seconds
    expect(result.tokens).toBe(3 + 1); // 3 + (0.5 * 2) = 4
  });

  it('returns the bucket unchanged when no time has elapsed', () => {
    const result = refillTokens(bucket, 0);
    expect(result.tokens).toBe(3);
    expect(result.lastRefillMs).toBe(0);
  });

  it('returns the bucket unchanged when elapsed time is negative', () => {
    const result = refillTokens(bucket, -100);
    expect(result.tokens).toBe(3);
    expect(result.lastRefillMs).toBe(0);
  });

  it('never exceeds maxTokens even with fractional additions', () => {
    const nearCap: TokenBucket = {
      tokens: 9.9,
      lastRefillMs: 1000,
      maxTokens: 10,
      refillRatePerSecond: 1,
    };
    const result = refillTokens(nearCap, 2000);
    expect(result.tokens).toBeCloseTo(10, 5); // max cap
    expect(result.tokens).toBeLessThanOrEqual(10);
  });

  it('is pure — does not mutate the input bucket', () => {
    const original: TokenBucket = { ...bucket };
    const result = refillTokens(bucket, 3000);
    expect(bucket.tokens).toBe(original.tokens);
    expect(bucket.lastRefillMs).toBe(original.lastRefillMs);
    expect(result).not.toBe(bucket); // different reference
  });
});

// ---------------------------------------------------------------------------
// never throws
// ---------------------------------------------------------------------------

describe('never throws', () => {
  it('retryDelay never throws for negative attempt', () => {
    expect(() => retryDelay(-1)).not.toThrow();
    expect(retryDelay(-5)).toBeGreaterThanOrEqual(0);
  });

  it('retryDelay never throws for NaN attempt', () => {
    expect(() => retryDelay(NaN)).not.toThrow();
  });

  it('idempotencyKey never throws for empty operation', () => {
    expect(() => idempotencyKey('', 'x', 0)).not.toThrow();
  });

  it('consumeToken never throws for a zero-token bucket with no refill', () => {
    const dead: TokenBucket = {
      tokens: 0,
      lastRefillMs: 0,
      maxTokens: 0,
      refillRatePerSecond: 0,
    };
    expect(() => consumeToken(dead, 0)).not.toThrow();
  });

  it('refillTokens never throws for NaN timestamps', () => {
    const b: TokenBucket = {
      tokens: 5,
      lastRefillMs: 0,
      maxTokens: 10,
      refillRatePerSecond: 2,
    };
    expect(() => refillTokens(b, NaN)).not.toThrow();
  });
});
