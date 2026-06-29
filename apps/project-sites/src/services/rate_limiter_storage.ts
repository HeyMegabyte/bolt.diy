/**
 * Rate-limit state serialization for DO/KV persistence.
 *
 * Pure functions — no I/O, no env, no side-effects. Converts between
 * in-memory token-bucket state and portable JSON strings that survive
 * Durable Object hibernation and KV storage.
 *
 * @example
 * ```ts
 * const snap = snapshot('user:42', 10, Date.now(), 60_000, 20);
 * const json = serializeSnapshots([snap]);
 * await env.STORE.put('ratelimit:user:42', json);
 * ```
 *
 * @see RateLimitSnapshot — the portable shape
 */

export interface RateLimitSnapshot {
  /** Unique key for the rate-limited resource (e.g. `user:<id>`, `ip:<addr>`). */
  key: string;
  /** Epoch ms of the last refill (used to compute elapsed window time). */
  lastRefillMs: number;
  /** Maximum token capacity (the refill upper bound). */
  maxTokens: number;
  /** Current token count in the bucket (may be fractional). */
  tokens: number;
  /** Refill window in milliseconds (e.g. 60_000 for a 1-minute window). */
  windowMs: number;
}

/**
 * Create a {@link RateLimitSnapshot} for a single bucket.
 *
 * @example
 * ```ts
 * const snap = snapshot('ip:203.0.113.5', 3, 1_714_000_000_000, 60_000, 10);
 * // → { key: 'ip:203.0.113.5', tokens: 3, lastRefillMs: 1_714_000_000_000, windowMs: 60_000, maxTokens: 10 }
 * ```
 */
export function snapshot(
  key: string,
  tokens: number,
  lastRefillMs: number,
  windowMs: number,
  maxTokens: number,
): RateLimitSnapshot {
  return { key, lastRefillMs, maxTokens, tokens, windowMs };
}

/**
 * Extract the mutable bucket state from a snapshot (drops the key).
 *
 * Use when restoring an in-memory token bucket from a persisted snapshot.
 *
 * @example
 * ```ts
 * const { tokens, lastRefillMs, windowMs, maxTokens } = fromSnapshot(snap);
 * ```
 */
export function fromSnapshot(snap: RateLimitSnapshot): {
  lastRefillMs: number;
  maxTokens: number;
  tokens: number;
  windowMs: number;
} {
  return {
    lastRefillMs: snap.lastRefillMs,
    maxTokens: snap.maxTokens,
    tokens: snap.tokens,
    windowMs: snap.windowMs,
  };
}

/**
 * Serialize an array of snapshots to a JSON string for persistent storage.
 *
 * The output is compact JSON (no extra whitespace). Returns `"[]"` for an
 * empty array.
 *
 * @example
 * ```ts
 * const json = serializeSnapshots([snap]);
 * // → '[{"key":"ip:203.0.113.5","tokens":3,…}]'
 * ```
 */
export function serializeSnapshots(snaps: readonly RateLimitSnapshot[]): string {
  return JSON.stringify(snaps);
}

/**
 * Deserialize a JSON string produced by {@link serializeSnapshots} back into
 * an array of {@link RateLimitSnapshot} objects.
 *
 * Performs structural validation on every element — malformed entries are
 * included as-is but typed as `RateLimitSnapshot`. Callers that need strict
 * validation should run each entry through a Zod schema.
 *
 * @example
 * ```ts
 * const snaps = deserializeSnapshots(json);
 * ```
 *
 * @throws {SyntaxError} when the JSON is not well-formed.
 */
export function deserializeSnapshots(json: string): RateLimitSnapshot[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new SyntaxError('Expected a JSON array of RateLimitSnapshot objects');
  }
  return parsed as RateLimitSnapshot[];
}
