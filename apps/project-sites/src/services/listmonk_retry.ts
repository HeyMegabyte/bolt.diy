/**
 * Listmonk retry/rate-limit wrapper — pure zero-I/O config calculator.
 *
 * @remarks
 * Every function NEVER throws and produces NO side-effects (no I/O, no
 * Math.random). All functions accept an optional `nowMs` parameter so the
 * caller can inject determinism for testing. The actual fetch caller consumes
 * these helpers to add idempotency + exponential backoff + token-bucket
 * rate limiting to every Listmonk API call.
 *
 * @example
 * ```ts
 * const delay = retryDelay(2); // exponential backoff for 3rd attempt
 * const key = idempotencyKey('upsertSubscriber', 'user@example.com');
 * const { allowed, bucket: newBucket } = consumeToken(myBucket);
 * ```
 */

// ---------------------------------------------------------------------------
// RetryConfig
// ---------------------------------------------------------------------------

/**
 * Retry configuration for Listmonk API calls.
 *
 * @remarks
 * All fields are readonly — pass by value, never mutate in place.
 */
export interface RetryConfig {
  readonly maxRetries: number;
  /** Starting backoff in milliseconds (default 1000). */
  readonly baseDelayMs: number;
  /** Maximum delay cap in milliseconds (default 30000). */
  readonly maxDelayMs: number;
  /** When true, multiply the delay by a deterministic pseudo-jitter factor. */
  readonly jitter: boolean;
}

/**
 * Default retry config for Listmonk API calls.
 *
 * - `baseDelayMs`: 1000
 * - `jitter`: true
 * - `maxDelayMs`: 30000
 * - `maxRetries`: 3
 */
export const LISTMONK_RETRY: RetryConfig = {
  baseDelayMs: 1000,
  jitter: true,
  maxDelayMs: 30000,
  maxRetries: 3,
} as const;

// ---------------------------------------------------------------------------
// retryDelay
// ---------------------------------------------------------------------------

/**
 * Compute the delay (ms) before retry attempt N (0-indexed).
 *
 * The delay grows exponentially: `min(baseDelay * 2^attempt, maxDelay)`.
 * When `jitter` is enabled the delay is multiplied by a deterministic
 * pseudo-random factor in [0.5, 1.5) derived from the attempt number and
 * base delay — NOT Math.random(), so the result is reproducible for the same
 * inputs.
 *
 * @param attempt - Zero-indexed retry attempt number (0 = first retry).
 * @param config - Retry configuration; defaults to {@link LISTMONK_RETRY}.
 * @returns The delay in milliseconds, clamped to `config.maxDelayMs`.
 *
 * @example
 * ```ts
 * retryDelay(0); // ~1000 (with jitter ~500-1500)
 * retryDelay(1); // ~2000 (with jitter ~1000-3000)
 * retryDelay(4, { ...LISTMONK_RETRY, maxDelayMs: 30000 }); // 30000 (capped)
 * ```
 */
export function retryDelay(attempt: number, config: RetryConfig = LISTMONK_RETRY): number {
  const rawDelay = config.baseDelayMs * Math.pow(2, attempt);
  const clamped = Math.min(rawDelay, config.maxDelayMs);

  if (!config.jitter) {
    return clamped;
  }

  // Deterministic pseudo-jitter in [0.5, 1.5) from attempt + baseDelayMs.
  const factor = 0.5 + ((attempt * 7 + config.baseDelayMs) % 100) / 100;
  return Math.min(clamped * factor, config.maxDelayMs);
}

// ---------------------------------------------------------------------------
// idempotencyKey
// ---------------------------------------------------------------------------

/**
 * Mint an idempotency key for a Listmonk API call.
 *
 * The key format is `{operation}_{email}_{nowMs}`. This is NOT a UUID — it is
 * a readable, debuggable string that ensures uniqueness per attempt window.
 *
 * @param operation - Short operation name (e.g. `'upsertSubscriber'`).
 * @param email - The target email address or numeric identifier.
 * @param nowMs - Current epoch ms; defaults to `Date.now()`. Pass for
 *   deterministic test output.
 * @returns A string key like `'upsertSubscriber_user@example.com_1719400000000'`.
 *
 * @example
 * ```ts
 * idempotencyKey('upsertSubscriber', 'user@example.com', 1719400000000);
 * // → 'upsertSubscriber_user@example.com_1719400000000'
 * ```
 */
export function idempotencyKey(operation: string, email: string | number, nowMs?: number): string {
  return `${operation}_${email.toString()}_${nowMs ?? Date.now()}`;
}

// ---------------------------------------------------------------------------
// TokenBucket
// ---------------------------------------------------------------------------

/**
 * Rate-limit token bucket state.
 *
 * @remarks
 * Pure data — the caller persists the state between calls (e.g. in a `let`
 * variable, or in `ctx.var`). All mutations return a new {@link TokenBucket}
 * instance; the original is never modified.
 */
export interface TokenBucket {
  /** Current token count (may be fractional after refill). */
  readonly tokens: number;
  /** Epoch ms of the last refill or consume operation. */
  readonly lastRefillMs: number;
  /** Maximum token capacity. */
  readonly maxTokens: number;
  /** Tokens added per second during refill. */
  readonly refillRatePerSecond: number;
}

// ---------------------------------------------------------------------------
// consumeToken
// ---------------------------------------------------------------------------

/**
 * Attempt to consume one token from the bucket.
 *
 * @remarks
 * First applies a time-based refill (via {@link refillTokens}), then allows
 * the call if the updated bucket has ≥1 token. If allowed the bucket is
 * decremented by 1; if blocked the bucket is returned unchanged.
 *
 * @param bucket - The current bucket state.
 * @param nowMs - Current epoch ms; defaults to `Date.now()`.
 * @returns A result with `allowed` and the (possibly updated) `bucket`.
 *
 * @example
 * ```ts
 * const { allowed, bucket } = consumeToken(myBucket, Date.now());
 * if (allowed) {
 *   // make the API call
 * }
 * ```
 */
export function consumeToken(
  bucket: TokenBucket,
  nowMs?: number,
): { allowed: boolean; bucket: TokenBucket } {
  const now = nowMs ?? Date.now();
  const refilled = refillTokens(bucket, now);

  if (refilled.tokens < 1) {
    return { allowed: false, bucket: refilled };
  }

  return {
    allowed: true,
    bucket: {
      lastRefillMs: refilled.lastRefillMs,
      maxTokens: refilled.maxTokens,
      refillRatePerSecond: refilled.refillRatePerSecond,
      tokens: refilled.tokens - 1,
    },
  };
}

// ---------------------------------------------------------------------------
// refillTokens
// ---------------------------------------------------------------------------

/**
 * Refill tokens based on elapsed time since the last refill.
 *
 * @remarks
 * Tokens are added at `refillRatePerSecond` per second of elapsed wall-clock
 * time. The result is capped at `maxTokens`. The `lastRefillMs` is updated
 * to reflect the stamp of the refill (the caller's `nowMs`), so subsequent
 * refills start from the right point.
 *
 * @param bucket - The current bucket state.
 * @param nowMs - Current epoch ms; defaults to `Date.now()`.
 * @returns A new {@link TokenBucket} with tokens possibly added.
 *
 * @example
 * ```ts
 * const fresh = refillTokens(bucket, bucket.lastRefillMs + 5000);
 * // 5 seconds of refill added (up to maxTokens)
 * ```
 */
export function refillTokens(bucket: TokenBucket, nowMs?: number): TokenBucket {
  const now = nowMs ?? Date.now();
  const elapsedMs = now - bucket.lastRefillMs;

  if (elapsedMs <= 0) {
    return bucket;
  }

  const added = (elapsedMs / 1000) * bucket.refillRatePerSecond;
  const newTokens = Math.min(bucket.tokens + added, bucket.maxTokens);

  return {
    lastRefillMs: now,
    maxTokens: bucket.maxTokens,
    refillRatePerSecond: bucket.refillRatePerSecond,
    tokens: newTokens,
  };
}
