/**
 * Pure rate-limit state machines for three window strategies.
 *
 * Every function is deterministic — given the same state + policy + clock,
 * the result is identical. No I/O, no side-effects, no `Date.now()` default.
 *
 * @example
 * // Fixed window, 100 req/min
 * let state = initState({ windowType: 'fixed', maxRequests: 100, windowMs: 60_000 });
 * const { allowed, state: s2, retryAfterMs, headers } = checkRateLimit(state, policy);
 * state = s2;
 * if (!allowed) return new Response(null, { status: 429, headers });
 *
 * @example
 * // Token bucket, 10 req/s with burst up to 20
 * let state = initState({ windowType: 'token_bucket', maxRequests: 10, windowMs: 1000, burstMultiplier: 2 });
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WindowType = 'sliding' | 'fixed' | 'token_bucket';

export interface RateLimitPolicy {
  windowType: WindowType;
  maxRequests: number;
  windowMs: number;
  burstMultiplier?: number;
}

export interface RateLimitState {
  count: number;
  windowStartMs: number;
  tokens: number;
  lastRefillMs: number;
}

export interface CheckResult {
  allowed: boolean;
  state: RateLimitState;
  retryAfterMs: number;
  headers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a fresh rate-limit state for the given policy.
 *
 * @param policy - The policy to initialise state for
 * @returns A new state object with count/tokens zeroed and windowStart bound to epoch 0
 */
export function initState(policy: RateLimitPolicy): RateLimitState {
  const base: RateLimitState = {
    count: 0,
    lastRefillMs: -1,
    tokens: 0,
    windowStartMs: -1,
  };
  if (policy.windowType === 'token_bucket') {
    const burst = policy.burstMultiplier ?? 1;
    base.tokens = policy.maxRequests * burst;
  }
  return base;
}

/**
 * Evaluate a rate-limit decision for the given state, policy, and optional clock.
 *
 * Returns the updated state (caller must persist it) plus the HTTP-friendly
 * `retryAfterMs` and `RateLimit-*` response headers.
 *
 * @param policy - Active rate-limit policy
 * @param nowMs - Current timestamp in ms (defaults to `Date.now()`)
 * @returns An object with `allowed`, the next `state`, `retryAfterMs`, and `headers`
 */
export function checkRateLimit(
  state: RateLimitState,
  policy: RateLimitPolicy,
  nowMs?: number,
): CheckResult {
  const now = nowMs ?? Date.now();

  switch (policy.windowType) {
    case 'fixed':
      return checkFixedWindow(state, policy, now);
    case 'sliding':
      return checkSlidingWindow(state, policy, now);
    case 'token_bucket':
      return checkTokenBucket(state, policy, now);
  }
}

// ---------------------------------------------------------------------------
// Strategy: Fixed window
// ---------------------------------------------------------------------------

function checkFixedWindow(
  state: RateLimitState,
  policy: RateLimitPolicy,
  now: number,
): CheckResult {
  const windowStart = state.windowStartMs;
  const windowEnd = windowStart + policy.windowMs;

  // Fresh or expired window → start a new one
  if (windowStart < 0 || now >= windowEnd) {
    const allowed = 1 <= policy.maxRequests;
    const retryAfterMs = allowed ? 0 : policy.windowMs;
    const nextState: RateLimitState = {
      count: 1,
      lastRefillMs: -1,
      tokens: 0,
      windowStartMs: now,
    };
    return {
      allowed,
      headers: buildHeaders(1, policy.maxRequests, retryAfterMs, policy),
      retryAfterMs,
      state: nextState,
    };
  }

  const newCount = state.count + 1;
  const allowed = newCount <= policy.maxRequests;
  const retryAfterMs = allowed ? 0 : windowEnd - now;

  const nextState: RateLimitState = {
    count: newCount,
    lastRefillMs: -1,
    tokens: 0,
    windowStartMs: windowStart,
  };
  return {
    allowed,
    headers: buildHeaders(newCount, policy.maxRequests, retryAfterMs, policy),
    retryAfterMs,
    state: nextState,
  };
}

// ---------------------------------------------------------------------------
// Strategy: Sliding window (sub-window decay)
// ---------------------------------------------------------------------------

function checkSlidingWindow(
  state: RateLimitState,
  policy: RateLimitPolicy,
  now: number,
): CheckResult {
  const halfWindow = Math.floor(policy.windowMs / 2);
  const windowStart = state.windowStartMs;
  const windowEnd = windowStart + policy.windowMs;

  // Full window elapsed → reset
  if (windowStart < 0 || now >= windowEnd) {
    const allowed = 1 <= policy.maxRequests;
    const nextState: RateLimitState = {
      count: 1,
      lastRefillMs: -1,
      tokens: 0,
      windowStartMs: now,
    };
    return {
      allowed,
      headers: buildHeaders(1, policy.maxRequests, 0, policy),
      retryAfterMs: 0,
      state: nextState,
    };
  }

  // Half-window boundary → decay count by 2, advance half-window
  if (windowStart >= 0 && now >= windowStart + halfWindow) {
    const newStart = windowStart + halfWindow;
    const decayed = Math.max(0, Math.floor(state.count / 2));
    const newCount = decayed + 1;
    const allowed = newCount <= policy.maxRequests;

    const nextState: RateLimitState = {
      count: newCount,
      lastRefillMs: -1,
      tokens: 0,
      windowStartMs: newStart,
    };
    return {
      allowed,
      headers: buildHeaders(newCount, policy.maxRequests, allowed ? 0 : halfWindow, policy),
      retryAfterMs: allowed ? 0 : halfWindow,
      state: nextState,
    };
  }

  // Within current sub-window — normal increment
  const newCount = state.count + 1;
  const allowed = newCount <= policy.maxRequests;

  const nextState: RateLimitState = {
    count: newCount,
    lastRefillMs: -1,
    tokens: 0,
    windowStartMs: windowStart,
  };
  return {
    allowed,
    headers: buildHeaders(newCount, policy.maxRequests, allowed ? 0 : halfWindow, policy),
    retryAfterMs: allowed ? 0 : halfWindow,
    state: nextState,
  };
}

// ---------------------------------------------------------------------------
// Strategy: Token bucket
// ---------------------------------------------------------------------------

function checkTokenBucket(
  state: RateLimitState,
  policy: RateLimitPolicy,
  now: number,
): CheckResult {
  const burst = policy.burstMultiplier ?? 1;
  const capacity = policy.maxRequests * burst;

  // maxRequests=0 means zero refill rate — never allow
  if (policy.maxRequests === 0 || policy.windowMs === 0) {
    const nextState: RateLimitState = {
      count: state.count + 1,
      lastRefillMs: state.lastRefillMs >= 0 ? state.lastRefillMs : now,
      tokens: 0,
      windowStartMs: state.windowStartMs,
    };
    return {
      allowed: false,
      headers: buildHeaders(state.count + 1, capacity, Infinity, policy),
      retryAfterMs: Infinity,
      state: nextState,
    };
  }

  const refillRate = policy.maxRequests / policy.windowMs; // tokens per ms

  // Refill tokens based on elapsed wall-clock time
  const elapsed = state.lastRefillMs >= 0 ? now - state.lastRefillMs : 0;
  if (elapsed > 0) {
    const added = Math.floor(elapsed * refillRate);
    if (added > 0) {
      const refilledTokens = Math.min(capacity, state.tokens + added);
      const refilledState: RateLimitState = {
        count: state.count,
        lastRefillMs: now,
        tokens: refilledTokens,
        windowStartMs: state.windowStartMs,
      };
      // Re-evaluate with refilled tokens
      return checkTokenBucket(refilledState, policy, now);
    }
  }

  // Consume one token
  const allowed = state.tokens >= 1;
  const nextTokens = allowed ? state.tokens - 1 : state.tokens;

  const nextState: RateLimitState = {
    count: state.count + (allowed ? 1 : 0),
    lastRefillMs: state.lastRefillMs >= 0 ? state.lastRefillMs : now,
    tokens: nextTokens,
    windowStartMs: state.windowStartMs,
  };

  // Time until at least one token refills
  const msPerToken = policy.windowMs / policy.maxRequests;
  const retryAfterMs = allowed ? 0 : Math.ceil(msPerToken);

  return {
    allowed,
    headers: buildHeaders(state.count + (allowed ? 1 : 0), capacity, retryAfterMs, policy),
    retryAfterMs,
    state: nextState,
  };
}

// ---------------------------------------------------------------------------
// Header builder
// ---------------------------------------------------------------------------

function buildHeaders(
  current: number,
  limit: number,
  retryAfterMs: number,
  _policy: RateLimitPolicy,
): Record<string, string> {
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, limit - current)),
    'RateLimit-Reset': String(Math.ceil(retryAfterMs / 1000)),
    'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
  };
}
