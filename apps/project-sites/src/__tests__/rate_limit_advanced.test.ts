/**
 * Unit tests for the three rate-limit state machines.
 *
 * Every test supplies an explicit `nowMs` clock so results are deterministic.
 */
import { initState, checkRateLimit } from '../services/rate_limit_advanced.js';
import type { RateLimitPolicy } from '../services/rate_limit_advanced.js';

// ---------------------------------------------------------------------------
// initState
// ---------------------------------------------------------------------------

describe('initState', () => {
  it('zeroes count and windowStart for fixed-window policies', () => {
    const s = initState({ windowType: 'fixed', maxRequests: 10, windowMs: 1000 });
    expect(s.count).toBe(0);
    expect(s.windowStartMs).toBe(-1);
    expect(s.tokens).toBe(0);
  });

  it('zeroes count and windowStart for sliding-window policies', () => {
    const s = initState({ windowType: 'sliding', maxRequests: 10, windowMs: 1000 });
    expect(s.count).toBe(0);
    expect(s.windowStartMs).toBe(-1);
  });

  it('seeds tokens to capacity for token-bucket policies', () => {
    const s = initState({
      windowType: 'token_bucket',
      maxRequests: 10,
      windowMs: 1000,
      burstMultiplier: 2,
    });
    expect(s.count).toBe(0);
    expect(s.tokens).toBe(20); // maxRequests * burstMultiplier
  });

  it('defaults burstMultiplier to 1 when omitted', () => {
    const s = initState({ windowType: 'token_bucket', maxRequests: 10, windowMs: 1000 });
    expect(s.tokens).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Fixed window
// ---------------------------------------------------------------------------

describe('fixed window', () => {
  const policy: RateLimitPolicy = { windowType: 'fixed', maxRequests: 3, windowMs: 10_000 };

  it('allows the first N requests within the window', () => {
    let state = initState(policy);

    for (let i = 0; i < 3; i++) {
      const r = checkRateLimit(state, policy, 0);
      expect(r.allowed).toBe(true);
      expect(r.retryAfterMs).toBe(0);
      state = r.state;
    }
    expect(state.count).toBe(3);
  });

  it('blocks the (N+1)th request within the same window', () => {
    let state = initState(policy);
    // Saturate the window
    for (let i = 0; i < 3; i++) {
      state = checkRateLimit(state, policy, 0).state;
    }

    const r = checkRateLimit(state, policy, 0);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
    // Should wait until windowEnd - now = 10_000 - 0
    expect(r.retryAfterMs).toBe(10_000);
  });

  it('resets the window after windowMs elapses', () => {
    let state = initState(policy);
    for (let i = 0; i < 3; i++) {
      state = checkRateLimit(state, policy, 0).state;
    }
    // Advance clock past the end of the window
    const r = checkRateLimit(state, policy, 10_001);
    expect(r.allowed).toBe(true);
    expect(r.state.count).toBe(1);
    expect(r.state.windowStartMs).toBeGreaterThan(0);
  });

  it('includes RateLimit-* headers on every response', () => {
    const r = checkRateLimit(initState(policy), policy, 0);
    expect(r.headers['RateLimit-Limit']).toBe('3');
    expect(r.headers['RateLimit-Remaining']).toBe('2');
    expect(r.headers['RateLimit-Reset']).toBe('0');
    expect(r.headers['Retry-After']).toBe('0');
  });

  it('RateLimit-Remaining reaches 0 at the limit', () => {
    let state = initState(policy);
    for (let i = 0; i < 3; i++) {
      const r = checkRateLimit(state, policy, 0);
      state = r.state;
      expect(Number(r.headers['RateLimit-Remaining'])).toBe(3 - (i + 1));
    }
  });
});

// ---------------------------------------------------------------------------
// Sliding window
// ---------------------------------------------------------------------------

describe('sliding window', () => {
  const policy: RateLimitPolicy = { windowType: 'sliding', maxRequests: 4, windowMs: 10_000 };

  it('allows up to maxRequests within a half-window', () => {
    let state = initState(policy);
    for (let i = 0; i < 4; i++) {
      const r = checkRateLimit(state, policy, 0);
      expect(r.allowed).toBe(true);
      state = r.state;
    }
  });

  it('blocks the (N+1)th request within a half-window', () => {
    let state = initState(policy);
    for (let i = 0; i < 4; i++) {
      state = checkRateLimit(state, policy, 0).state;
    }
    const r = checkRateLimit(state, policy, 0);
    expect(r.allowed).toBe(false);
  });

  it('decays the count after half the window passes', () => {
    let state = initState(policy);
    // Saturate within the first half-window
    for (let i = 0; i < 4; i++) {
      state = checkRateLimit(state, policy, 0).state;
    }
    // Blocked
    expect(checkRateLimit(state, policy, 0).allowed).toBe(false);

    // Advance past the half-window boundary (5_001ms into a 10s window)
    // Decay: floor(4 / 2) + 1 = 3 → allowed (3 <= 4)
    const r = checkRateLimit(state, policy, 5_001);
    expect(r.allowed).toBe(true);
    expect(r.state.count).toBe(3);
    expect(r.state.windowStartMs).toBe(5_000);
  });

  it('resets fully when the full window elapses', () => {
    let state = initState(policy);
    for (let i = 0; i < 4; i++) {
      state = checkRateLimit(state, policy, 0).state;
    }
    const r = checkRateLimit(state, policy, 10_001);
    expect(r.allowed).toBe(true);
    expect(r.state.count).toBe(1);
    expect(r.state.windowStartMs).toBe(10_001);
  });
});

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------

describe('token bucket', () => {
  const policy: RateLimitPolicy = {
    windowType: 'token_bucket',
    maxRequests: 10,
    windowMs: 1000,
    burstMultiplier: 2,
  };

  it('allows bursts up to capacity', () => {
    let state = initState(policy); // 20 tokens
    // Drain all 20 tokens
    for (let i = 0; i < 20; i++) {
      const r = checkRateLimit(state, policy, 0);
      expect(r.allowed).toBe(true);
      state = r.state;
    }
    expect(state.tokens).toBe(0);
  });

  it('blocks when tokens are exhausted', () => {
    let state = initState(policy);
    for (let i = 0; i < 20; i++) {
      state = checkRateLimit(state, policy, 0).state;
    }
    const r = checkRateLimit(state, policy, 0);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills tokens over time', () => {
    let state = initState(policy);
    for (let i = 0; i < 20; i++) {
      state = checkRateLimit(state, policy, 0).state;
    }
    expect(state.tokens).toBe(0);

    // Advance 500ms — at 10 tokens/s (10/1000ms → 0.01 tokens/ms), should regain ~5 tokens
    const r = checkRateLimit(state, policy, 500);
    expect(r.allowed).toBe(true); // had at least 1 token

    // More than 500ms later, tokens should have been refilled
    const r2 = checkRateLimit(state, policy, 1001);
    expect(r2.allowed).toBe(true);
    // Should have refilled at least 10 tokens
    expect(r2.state.tokens).toBeGreaterThanOrEqual(9); // 10 - 1 consumed
  });

  it('caps tokens at capacity', () => {
    let state = initState(policy); // 20 tokens
    // Wait a long time
    const r = checkRateLimit(state, policy, 100_000);
    expect(r.allowed).toBe(true);
    // Tokens should be at capacity minus the one consumed
    expect(r.state.tokens).toBeLessThanOrEqual(20);
  });

  it('defaults burstMultiplier to 1 when omitted', () => {
    const p: RateLimitPolicy = { windowType: 'token_bucket', maxRequests: 5, windowMs: 1000 };
    let state = initState(p);
    expect(state.tokens).toBe(5);
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit(state, p, 0);
      expect(r.allowed).toBe(true);
      state = r.state;
    }
    // 6th is blocked
    expect(checkRateLimit(state, p, 0).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-strategy: default nowMs
// ---------------------------------------------------------------------------

describe('default nowMs (Date.now)', () => {
  it('allows a single request immediately', () => {
    const policy: RateLimitPolicy = { windowType: 'fixed', maxRequests: 10, windowMs: 60_000 };
    const r = checkRateLimit(initState(policy), policy);
    expect(r.allowed).toBe(true);
    // Defaults via Date.now() internally — no crash is the assertion
    expect(typeof r.retryAfterMs).toBe('number');
    expect(r.headers['RateLimit-Limit']).toBe('10');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles maxRequests=0 by blocking every request (fixed)', () => {
    const policy: RateLimitPolicy = { windowType: 'fixed', maxRequests: 0, windowMs: 60_000 };
    let state = initState(policy);
    const r = checkRateLimit(state, policy, 0);
    expect(r.allowed).toBe(false);
  });

  it('handles maxRequests=0 by blocking every request (token_bucket)', () => {
    const policy: RateLimitPolicy = { windowType: 'token_bucket', maxRequests: 0, windowMs: 1000 };
    let state = initState(policy);
    const r = checkRateLimit(state, policy, 0);
    expect(r.allowed).toBe(false);
  });

  it('handles maxRequests=1 correctly (fixed)', () => {
    const policy: RateLimitPolicy = { windowType: 'fixed', maxRequests: 1, windowMs: 10_000 };
    let state = initState(policy);
    let r = checkRateLimit(state, policy, 0);
    expect(r.allowed).toBe(true);
    state = r.state;
    r = checkRateLimit(state, policy, 0);
    expect(r.allowed).toBe(false);
    // After window expires
    r = checkRateLimit(state, policy, 10_001);
    expect(r.allowed).toBe(true);
  });

  it('retryAfterMs is the window-end delta for blocked fixed-window', () => {
    const policy: RateLimitPolicy = { windowType: 'fixed', maxRequests: 1, windowMs: 10_000 };
    let state = initState(policy);
    state = checkRateLimit(state, policy, 5_000).state;
    const r = checkRateLimit(state, policy, 5_000);
    expect(r.allowed).toBe(false);
    // windowEnd = 5_000 + 10_000 = 15_000, now = 5_000 → retryAfterMs = 10_000
    expect(r.retryAfterMs).toBe(10_000);
  });

  it('headers use integer seconds for RateLimit-Reset and Retry-After', () => {
    const policy: RateLimitPolicy = { windowType: 'fixed', maxRequests: 1, windowMs: 60_000 };
    let state = initState(policy);
    state = checkRateLimit(state, policy, 100).state;
    const r = checkRateLimit(state, policy, 100);
    // retryAfterMs for blocked = 60_000 - 100 = 59_900 → ceil(59_900 / 1000) = 60
    expect(r.headers['RateLimit-Reset']).toBe('60');
    expect(r.headers['Retry-After']).toBe('60');
  });
});
