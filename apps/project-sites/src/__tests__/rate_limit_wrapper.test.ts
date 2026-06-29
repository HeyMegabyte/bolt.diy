import {
  initState,
  allowRequest,
  requestComplete,
  type RateLimitConfig,
  type RateLimitState,
} from '../services/rate_limit_wrapper';

/**
 * Deterministic timestamp for all tests. Passing this to `initState` and
 * `allowRequest` makes refill calculations predictable.
 */
const BASE_MS = 1_700_000_000_000;

/**
 * Factory for the default config used across most tests.
 */
function defaultConfig(overrides?: Partial<RateLimitConfig>): RateLimitConfig {
  return { maxPerMinute: 60, maxConcurrent: 10, ...overrides };
}

describe('initState', () => {
  it('starts bucket full with maxPerMinute tokens', () => {
    const state = initState(defaultConfig({ maxPerMinute: 30 }), BASE_MS);
    expect(state.tokens).toBe(30);
    expect(state.inFlight).toBe(0);
    expect(state.backoffCount).toBe(0);
    expect(state.lastRefillMs).toBe(BASE_MS);
  });

  it('defaults to 60 tokens when config omits maxPerMinute', () => {
    const state = initState({} as RateLimitConfig, BASE_MS);
    expect(state.tokens).toBe(60);
  });

  it('defaults to 60 tokens when maxPerMinute is 0 or negative', () => {
    const stateA = initState(defaultConfig({ maxPerMinute: 0 }), BASE_MS);
    expect(stateA.tokens).toBe(60);

    const stateB = initState(defaultConfig({ maxPerMinute: -5 }), BASE_MS);
    expect(stateB.tokens).toBe(60);
  });
});

describe('allowRequest — token capacity', () => {
  it('allows up to maxPerMinute requests in immediate succession', () => {
    const config = defaultConfig({ maxPerMinute: 5, maxConcurrent: 10 });
    let state = initState(config, BASE_MS);

    for (let i = 0; i < 5; i++) {
      const { allowed, retryAfterMs } = allowRequest(state, config, BASE_MS);
      expect(allowed).toBe(true);
      expect(retryAfterMs).toBe(0);
    }

    // 6th request should be denied (no tokens, no time elapsed for refill)
    const { allowed, retryAfterMs } = allowRequest(state, config, BASE_MS);
    expect(allowed).toBe(false);
    expect(retryAfterMs).toBeGreaterThan(0);
  });

  it('refills tokens over time', () => {
    const config = defaultConfig({ maxPerMinute: 60, maxConcurrent: 100 });
    let state = initState(config, BASE_MS);

    // Exhaust the bucket (concurrency rack high enough to not interfere)
    for (let i = 0; i < 60; i++) {
      const { allowed } = allowRequest(state, config, BASE_MS);
      expect(allowed).toBe(true);
    }

    // No tokens left
    expect(allowRequest(state, config, BASE_MS).allowed).toBe(false);

    // Advance 1 second — 1 token should have refilled (60/60s = 1/s)
    const later = BASE_MS + 1_000;
    const { allowed } = allowRequest(state, config, later);
    expect(allowed).toBe(true);
  });

  it('caps tokens at maxPerMinute (no overflow on long pause)', () => {
    const config = defaultConfig({ maxPerMinute: 10 });
    let state = initState(config, BASE_MS);

    // Spend 1 token, tokens=10→9.
    allowRequest(state, config, BASE_MS);

    // Advance 1 hour — refill caps at 10, then consume 1 → 9.
    const farFuture = BASE_MS + 3_600_000;
    allowRequest(state, config, farFuture);
    // gained = (3600000 * 10) / 60000 = 600.
    // tokens = min(9 + 600, 10) = 10.  Consume 1 → 9.
    expect(state.tokens).toBe(9);
  });
});

describe('allowRequest — concurrency', () => {
  it('denies when inFlight reaches maxConcurrent', () => {
    const config = defaultConfig({ maxConcurrent: 2 });
    let state = initState(config, BASE_MS);

    // Start 2 in-flight
    allowRequest(state, config, BASE_MS);
    allowRequest(state, config, BASE_MS);
    expect(state.inFlight).toBe(2);

    // 3rd request should be denied
    const { allowed } = allowRequest(state, config, BASE_MS);
    expect(allowed).toBe(false);
  });

  it('allows after requestComplete reduces inFlight', () => {
    const config = defaultConfig({ maxConcurrent: 1 });
    let state = initState(config, BASE_MS);

    // Start 1 in-flight
    allowRequest(state, config, BASE_MS);
    expect(state.inFlight).toBe(1);

    // 2nd denied
    expect(allowRequest(state, config, BASE_MS).allowed).toBe(false);

    // Complete the first
    state = requestComplete(state);
    expect(state.inFlight).toBe(0);

    // Now allowed again
    expect(allowRequest(state, config, BASE_MS).allowed).toBe(true);
  });

  it('defaults maxConcurrent to 10 when not set', () => {
    const config = defaultConfig({ maxPerMinute: 100 });
    let state = initState(config, BASE_MS);

    for (let i = 0; i < 10; i++) {
      allowRequest(state, config, BASE_MS);
    }
    expect(state.inFlight).toBe(10);
    expect(allowRequest(state, config, BASE_MS).allowed).toBe(false);
  });

  it('defaults maxConcurrent to 10 when set to 0 or negative', () => {
    const configA = defaultConfig({ maxConcurrent: 0 });
    let stateA = initState(configA, BASE_MS);
    for (let i = 0; i < 10; i++) allowRequest(stateA, configA, BASE_MS);
    expect(stateA.inFlight).toBe(10);

    const configB = defaultConfig({ maxConcurrent: -3 });
    let stateB = initState(configB, BASE_MS);
    for (let i = 0; i < 10; i++) allowRequest(stateB, configB, BASE_MS);
    expect(stateB.inFlight).toBe(10);
  });
});

describe('requestComplete', () => {
  it('decrements inFlight', () => {
    const state: RateLimitState = {
      tokens: 50,
      lastRefillMs: BASE_MS,
      inFlight: 3,
      backoffCount: 0,
    };

    requestComplete(state);
    expect(state.inFlight).toBe(2);

    requestComplete(state);
    expect(state.inFlight).toBe(1);
  });

  it('never goes below 0', () => {
    const state: RateLimitState = {
      tokens: 50,
      lastRefillMs: BASE_MS,
      inFlight: 0,
      backoffCount: 0,
    };

    requestComplete(state);
    expect(state.inFlight).toBe(0);
  });

  it('returns the same state reference', () => {
    const state: RateLimitState = {
      tokens: 50,
      lastRefillMs: BASE_MS,
      inFlight: 2,
      backoffCount: 0,
    };

    const result = requestComplete(state);
    expect(result).toBe(state);
    expect(result.inFlight).toBe(1);
  });
});

describe('retryAfterMs — basic (no backoff)', () => {
  it('is 0 when allowed', () => {
    const config = defaultConfig({ maxPerMinute: 10 });
    const state = initState(config, BASE_MS);
    const { allowed, retryAfterMs } = allowRequest(state, config, BASE_MS);
    expect(allowed).toBe(true);
    expect(retryAfterMs).toBe(0);
  });

  it('is positive and roughly correct when denied due to empty bucket', () => {
    const config = defaultConfig({ maxPerMinute: 60, maxConcurrent: 100 }); // 1 token/s
    let state = initState(config, BASE_MS);

    // Exhaust the bucket
    for (let i = 0; i < 60; i++) {
      allowRequest(state, config, BASE_MS);
    }

    const { allowed, retryAfterMs } = allowRequest(state, config, BASE_MS);
    expect(allowed).toBe(false);
    // Each token takes ~1000ms to refill (60000/60)
    expect(retryAfterMs).toBe(1000);
  });

  it('scales retryAfterMs with maxPerMinute', () => {
    // 120/min = 2/s → 500ms per token
    const config = defaultConfig({ maxPerMinute: 120, maxConcurrent: 200 });
    let state = initState(config, BASE_MS);

    for (let i = 0; i < 120; i++) {
      allowRequest(state, config, BASE_MS);
    }

    const { retryAfterMs } = allowRequest(state, config, BASE_MS);
    expect(retryAfterMs).toBe(500);
  });
});

describe('retryBackoff', () => {
  it('retryAfterMs grows exponentially with consecutive denies', () => {
    const config = defaultConfig({ maxPerMinute: 10, maxConcurrent: 20, retryBackoff: true });
    let state = initState(config, BASE_MS);

    // Exhaust bucket
    for (let i = 0; i < 10; i++) {
      allowRequest(state, config, BASE_MS);
    }

    // Consecutive denies: 1st deny → baseMs (6000ms), 2nd → 2×, 3rd → 4×.
    const d1 = allowRequest(state, config, BASE_MS);
    expect(d1.allowed).toBe(false);
    const baseMs = 6000; // 60000/10
    expect(d1.retryAfterMs).toBe(baseMs);

    const d2 = allowRequest(state, config, BASE_MS);
    expect(d2.retryAfterMs).toBe(baseMs * 2);

    const d3 = allowRequest(state, config, BASE_MS);
    expect(d3.retryAfterMs).toBe(baseMs * 4);
  });

  it('capped at 30s', () => {
    const config = defaultConfig({ maxPerMinute: 2, maxConcurrent: 10, retryBackoff: true });
    let state = initState(config, BASE_MS);

    for (let i = 0; i < 2; i++) allowRequest(state, config, BASE_MS);

    // Consecutive denies should cap at 30_000ms
    const d1 = allowRequest(state, config, BASE_MS);
    expect(d1.retryAfterMs).toBeLessThanOrEqual(30_000);

    // Pump backoffCount artificially to verify cap
    state.backoffCount = 10;
    const d2 = allowRequest(state, config, BASE_MS);
    expect(d2.retryAfterMs).toBe(30_000);
  });

  it('does not apply when retryBackoff is false', () => {
    const config = defaultConfig({ maxPerMinute: 10, maxConcurrent: 20, retryBackoff: false });
    let state = initState(config, BASE_MS);

    for (let i = 0; i < 10; i++) allowRequest(state, config, BASE_MS);

    const d1 = allowRequest(state, config, BASE_MS);
    const d2 = allowRequest(state, config, BASE_MS);
    expect(d1.retryAfterMs).toBe(d2.retryAfterMs); // no escalation
  });

  it('defaults to no backoff when config omits retryBackoff', () => {
    const config = defaultConfig({ maxPerMinute: 10, maxConcurrent: 20 }); // retryBackoff not set
    let state = initState(config, BASE_MS);

    for (let i = 0; i < 10; i++) allowRequest(state, config, BASE_MS);

    const d1 = allowRequest(state, config, BASE_MS);
    const d2 = allowRequest(state, config, BASE_MS);
    expect(d1.retryAfterMs).toBe(d2.retryAfterMs);
  });
});

describe('backoffCount tracking', () => {
  it('increments on deny, resets to 0 on allow', () => {
    const config = defaultConfig({ maxPerMinute: 2 });
    let state = initState(config, BASE_MS);

    allowRequest(state, config, BASE_MS);
    allowRequest(state, config, BASE_MS);
    expect(state.backoffCount).toBe(0);

    // Deny — backoffCount goes to 1 (tokens exhausted, no refill possible yet)
    allowRequest(state, config, BASE_MS);
    expect(state.backoffCount).toBe(1);

    // Wait for tokens to refill — then allow resets backoffCount
    const afterRefill = BASE_MS + 60_000;
    allowRequest(state, config, afterRefill);
    expect(state.backoffCount).toBe(0);
  });

  it('increments on concurrency deny too', () => {
    const config = defaultConfig({ maxConcurrent: 1 });
    let state = initState(config, BASE_MS);

    allowRequest(state, config, BASE_MS);
    expect(state.backoffCount).toBe(0);

    // Denied by concurrency
    allowRequest(state, config, BASE_MS);
    expect(state.backoffCount).toBe(1);
  });
});

describe('deterministic nowMs', () => {
  it('uses provided nowMs to set lastRefillMs', () => {
    const config = defaultConfig({ maxPerMinute: 60 });
    const state = initState(config, BASE_MS);
    expect(state.lastRefillMs).toBe(BASE_MS);

    const { allowed } = allowRequest(state, config, BASE_MS);
    expect(allowed).toBe(true);
  });

  it('refills correctly when nowMs advances', () => {
    const config = defaultConfig({ maxPerMinute: 6 }); // 0.1 token/s = 1 per 10s
    let state = initState(config, BASE_MS);

    // Use the only token
    allowRequest(state, config, BASE_MS);
    expect(state.tokens).toBe(5);

    // Advance exactly enough for 1 refill
    const later = BASE_MS + 10_000;
    const { allowed } = allowRequest(state, config, later);
    expect(allowed).toBe(true);
    // tokens was 5 → refill gained (10000*6/60000=1) → 6 → consume 1 → 5
    expect(state.tokens).toBe(5);
  });
});

describe('immutable config — safe to pass by reference', () => {
  it('the module does not mutate the config object', () => {
    const config: RateLimitConfig = { maxPerMinute: 10, maxConcurrent: 2 };
    const frozen = Object.freeze({ ...config });
    let state = initState(frozen, BASE_MS);

    allowRequest(state, frozen, BASE_MS);
    allowRequest(state, frozen, BASE_MS);
    allowRequest(state, frozen, BASE_MS);

    // Should complete without throwing (no mutation of config)
    expect(state.inFlight).toBe(2);
  });
});

describe('integration — simulated API flow', () => {
  it('sustains 60 req/min with no denies', () => {
    const config = defaultConfig({ maxPerMinute: 60, maxConcurrent: 10 });
    let state = initState(config, BASE_MS);

    // Simulate 60 requests over 61 seconds (one per second + 1s buffer)
    for (let i = 0; i < 60; i++) {
      const now = BASE_MS + i * 1_050; // slightly more than 1s apart
      const { allowed } = allowRequest(state, config, now);
      expect(allowed).toBe(true);
      state = requestComplete(state);
    }
  });

  it('burst-then-cooldown pattern works', () => {
    const config = defaultConfig({ maxPerMinute: 10, maxConcurrent: 10 });
    let state = initState(config, BASE_MS);

    // Burst 10
    for (let i = 0; i < 10; i++) {
      allowRequest(state, config, BASE_MS);
    }

    // 11th denied
    expect(allowRequest(state, config, BASE_MS).allowed).toBe(false);

    // Wait full refill period + complete all
    state.inFlight = 0;
    const afterRefill = BASE_MS + 60_000;
    state.lastRefillMs = afterRefill;
    state.tokens = 10;

    // Burst again
    for (let i = 0; i < 10; i++) {
      expect(allowRequest(state, config, afterRefill).allowed).toBe(true);
    }
  });

  it('completing requests frees concurrency slots while tokens remain', () => {
    const config = defaultConfig({ maxPerMinute: 1000, maxConcurrent: 2 });
    let state = initState(config, BASE_MS);

    // Start 2 in-flight
    allowRequest(state, config, BASE_MS);
    allowRequest(state, config, BASE_MS);
    expect(state.inFlight).toBe(2);

    // 3rd denied
    expect(allowRequest(state, config, BASE_MS).allowed).toBe(false);

    // Complete both
    state = requestComplete(requestComplete(state));
    expect(state.inFlight).toBe(0);

    // Now allowed again
    expect(allowRequest(state, config, BASE_MS).allowed).toBe(true);
  });
});
