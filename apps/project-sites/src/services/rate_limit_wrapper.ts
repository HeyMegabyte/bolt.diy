/**
 * @module rate_limit_wrapper
 * @description Generalized token-bucket rate limiter for cross-service API calls.
 *
 * Pure — never throws, never touches I/O. Composable: the caller passes a config
 * and the wrapper gives back delay/drop decisions without driving the HTTP.
 *
 * ## Usage
 *
 * ```ts
 * import { initState, allowRequest, requestComplete } from '../services/rate_limit_wrapper.js';
 *
 * const config = { maxPerMinute: 30, maxConcurrent: 5 };
 * let state = initState(config);
 *
 * function callApi(): Promise<Response> {
 *   const decision = allowRequest(state, config);
 *   if (!decision.allowed) throw new Error(`Rate limited, retry in ${decision.retryAfterMs}ms`);
 *   state = decision.state;
 *   return fetch('https://api.example.com/data')
 *     .finally(() => { state = requestComplete(state); });
 * }
 * ```
 *
 * @packageDocumentation
 */

/**
 * Configuration for a rate-limited service.
 *
 * @remarks Mutable configs are safe to pass repeatedly — only `maxPerMinute`,
 * `maxConcurrent`, and `retryBackoff` are read each call.
 */
export interface RateLimitConfig {
  /** Maximum requests permitted per rolling 60-second window. Defaults to 60. */
  maxPerMinute: number;
  /** Maximum concurrent in-flight requests. Defaults to 10. */
  maxConcurrent?: number;
  /**
   * When `true`, `retryAfterMs` includes progressive backoff based on how
   * many consecutive decisions were `allowed: false`. Defaults to `false`.
   */
  retryBackoff?: boolean;
}

/**
 * Mutable token-bucket state.
 *
 * @remarks The caller must thread this through every `allowRequest` and
 * `requestComplete` call — the wrapper never stores mutable state internally.
 */
export interface RateLimitState {
  /** Current token count (floored to 0). */
  tokens: number;
  /** Timestamp (epoch ms) of the most recent refill calculation. */
  lastRefillMs: number;
  /** Number of requests currently in-flight (awaiting `requestComplete`). */
  inFlight: number;
  /**
   * Consecutive deny count since the last allowed request. Reset to 0 on
   * every `allowed: true` return. Used for progressive backoff when
   * `retryBackoff` is enabled.
   */
  backoffCount: number;
}

/**
 * Decision returned by {@link allowRequest}.
 */
export interface AllowDecision {
  /** Whether the request may proceed immediately. */
  allowed: boolean;
  /** Updated state — the caller MUST preserve this for the next call. */
  state: RateLimitState;
  /**
   * Milliseconds the caller should wait before retrying.
   *
   * - When `allowed: true`: always `0`.
   * - When `allowed: false`: time until a token is expected, optionally inflated
   *   by progressive backoff when `config.retryBackoff` is set.
   */
  retryAfterMs: number;
}

/**
 * Default value applied when `config.maxPerMinute` is undefined or < 1.
 */
const DEFAULT_MAX_PER_MINUTE = 60;

/**
 * Default value applied when `config.maxConcurrent` is undefined or < 1.
 */
const DEFAULT_MAX_CONCURRENT = 10;

/**
 * Creates a fresh {@link RateLimitState} from the given config.
 *
 * The bucket starts full (tokens === maxPerMinute) so the first burst of
 * requests up to the per-minute limit passes immediately. `inFlight` and
 * `backoffCount` start at 0.
 *
 * @param config - Rate limit parameters (only `maxPerMinute` is read).
 * @param nowMs - Deterministic timestamp (epoch ms). Defaults to `Date.now()`.
 * @returns A new state object with a full token bucket.
 *
 * @example
 * const state = initState({ maxPerMinute: 30, maxConcurrent: 5 });
 * // state.tokens === 30, state.inFlight === 0
 */
export function initState(config: RateLimitConfig, nowMs?: number): RateLimitState {
  const max = config.maxPerMinute > 0 ? config.maxPerMinute : DEFAULT_MAX_PER_MINUTE;
  return {
    backoffCount: 0,
    inFlight: 0,
    lastRefillMs: nowMs ?? Date.now(),
    tokens: max,
  };
}

/**
 * Determines whether a request may proceed under the token bucket + concurrency
 * limits defined by `config`.
 *
 * **Algorithm (token-bucket):**
 * 1. Refill tokens based on elapsed wall time since `state.lastRefillMs`.
 * 2. Enforce `maxConcurrent` — if `state.inFlight >= limit`, deny immediately.
 * 3. Consume one token if `state.tokens >= 1`.
 * 4. When `retryBackoff` is enabled and this is a consecutive deny, multiply
 *    `retryAfterMs` by `2^(backoffCount-1)` (exponential backoff capped at 30s).
 *
 * Pure — no side-effects, no I/O, no throws. Accepts deterministic `nowMs`
 * for testability.
 *
 * @param state - Current bucket state (mutated in place).
 * @param config - Rate limit parameters.
 * @param nowMs - Current time in epoch ms. Defaults to `Date.now()`.
 * @returns A decision object with the updated state and retry hint.
 *
 * @example
 * let state = initState({ maxPerMinute: 60 });
 * const { allowed, state: s, retryAfterMs } = allowRequest(state, config, 1_700_000_000_000);
 * // allowed: true   (bucket starts full)
 */
export function allowRequest(
  state: RateLimitState,
  config: RateLimitConfig,
  nowMs?: number,
): AllowDecision {
  const now = nowMs ?? Date.now();
  const max = config.maxPerMinute > 0 ? config.maxPerMinute : DEFAULT_MAX_PER_MINUTE;
  const concurrency =
    (config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT) > 0
      ? (config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT)
      : DEFAULT_MAX_CONCURRENT;

  // --- 1. Refill tokens ---
  const elapsed = now - state.lastRefillMs;
  if (elapsed > 0) {
    // Refill rate = maxPerMinute tokens per 60_000 ms
    const gained = (elapsed * max) / 60_000;
    state.tokens = Math.min(state.tokens + gained, max);
    state.lastRefillMs = now;
  }

  // --- 2. Enforce concurrency ---
  if (state.inFlight >= concurrency) {
    state.backoffCount += 1;
    return {
      allowed: false,
      retryAfterMs: computeRetryMs(max, state.backoffCount, config.retryBackoff ?? false),
      state,
    };
  }

  // --- 3. Consume one token ---
  if (state.tokens >= 1) {
    state.tokens -= 1;
    state.inFlight += 1;
    state.backoffCount = 0;
    return { allowed: true, retryAfterMs: 0, state };
  }

  // --- 4. No tokens available ---
  state.backoffCount += 1;
  return {
    allowed: false,
    retryAfterMs: computeRetryMs(max, state.backoffCount, config.retryBackoff ?? false),
    state,
  };
}

/**
 * Decrements the in-flight counter. Must be called when a previously-allowed
 * request completes (successfully or with an error).
 *
 * @param state - Current state (mutated in place).
 * @returns The same state reference with `inFlight` decremented.
 *
 * @example
 * state = requestComplete(state);
 * // state.inFlight is now one lower
 */
export function requestComplete(state: RateLimitState): RateLimitState {
  if (state.inFlight > 0) {
    state.inFlight -= 1;
  }
  return state;
}

// ---- Internal helpers ----

/**
 * Computes how long to wait before the next retry.
 *
 * Base calculation: time (ms) until one token is replenished, inferred from
 * the refill rate. When `useBackoff` is true and the caller has been denied
 * multiple times in a row, the base is multiplied by `2^(backoffCount - 1)`
 * (exponential backoff), capped at 30 seconds.
 */
function computeRetryMs(maxPerMinute: number, backoffCount: number, useBackoff: boolean): number {
  // Base: time in ms for one token to refill
  const baseMs = Math.ceil(60_000 / maxPerMinute);

  if (!useBackoff || backoffCount <= 1) {
    return baseMs;
  }

  // Exponential backoff: base × 2^(n-1), capped at 30s
  const multiplier = Math.min(Math.pow(2, backoffCount - 1), 30_000 / baseMs);
  return Math.ceil(baseMs * multiplier);
}
