/**
 * @module services/circuit_breaker
 *
 * Per-provider circuit breaker for the Unified Analytics ingestion plane
 * (Plane H of `_CONVERGENCE_BACKLOG.md`). The `EventDispatcher` Durable Object
 * keeps one breaker per downstream provider (Sentry / PostHog / GA4 / GTM) so a
 * single failing vendor fails fast instead of stalling the whole batch flush.
 *
 * Pure + deterministic: every time-sensitive method takes an explicit `now`
 * (epoch ms) so tests never touch the clock, and the full state serialises via
 * {@link CircuitBreaker.snapshot} / {@link CircuitBreaker.fromSnapshot} for
 * persistence in the DO's SQLite `circuit_breaker_state` table across crashes.
 *
 * State machine:
 * - **closed** — forward all events; each failure increments the counter; at
 *   `failureThreshold` consecutive failures the breaker trips to **open**.
 * - **open** — skip forwarding (log to the dead-letter queue) until
 *   `resetTimeoutMs` has elapsed since the last failure, then the next
 *   `allowRequest` transitions to **half_open**.
 * - **half_open** — permit exactly ONE trial; success closes the breaker (and
 *   resets the counter), failure re-opens it (and restarts the timer).
 *
 * @example
 * const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });
 * if (cb.allowRequest(now)) {
 *   try { await forward(); cb.recordSuccess(now); }
 *   catch { cb.recordFailure(now); }
 * }
 */

/** The three states of the breaker. */
export type CircuitState = 'closed' | 'open' | 'half_open';

/** Serialisable breaker state for DO/SQLite persistence. */
export interface CircuitBreakerSnapshot {
  state: CircuitState;
  /** Consecutive failures since the last success (reset to 0 on success). */
  failCount: number;
  /** Epoch ms of the most recent failure, or `null` if none yet. */
  lastFailAt: number | null;
  /** Epoch ms of the most recent success, or `null` if none yet. */
  lastSuccessAt: number | null;
}

/** Tuning options. Defaults match the Plane-H spec (5 fails, 60s reset). */
export interface CircuitBreakerOptions {
  /** Consecutive failures required to open the breaker. Default 5. */
  failureThreshold?: number;
  /** Milliseconds the breaker stays open before allowing a half-open trial. Default 60_000. */
  resetTimeoutMs?: number;
}

/**
 * A per-provider circuit breaker. Construct fresh, or rehydrate from a stored
 * snapshot via {@link CircuitBreaker.fromSnapshot}.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private _state: CircuitState;
  private _failCount: number;
  private _lastFailAt: number | null;
  private _lastSuccessAt: number | null;

  constructor(opts: CircuitBreakerOptions = {}, snapshot?: CircuitBreakerSnapshot) {
    this.failureThreshold = Math.max(1, opts.failureThreshold ?? 5);
    this.resetTimeoutMs = Math.max(0, opts.resetTimeoutMs ?? 60_000);
    this._state = snapshot?.state ?? 'closed';
    this._failCount = snapshot?.failCount ?? 0;
    this._lastFailAt = snapshot?.lastFailAt ?? null;
    this._lastSuccessAt = snapshot?.lastSuccessAt ?? null;
  }

  /** Rehydrate a breaker from a persisted snapshot. */
  static fromSnapshot(
    snapshot: CircuitBreakerSnapshot,
    opts: CircuitBreakerOptions = {},
  ): CircuitBreaker {
    return new CircuitBreaker(opts, snapshot);
  }

  /**
   * Whether a request may proceed at `now`. Has a side effect: an open breaker
   * whose `resetTimeoutMs` has elapsed transitions to `half_open` here (and
   * permits the single trial). Half-open permits exactly one in-flight trial;
   * call `recordSuccess`/`recordFailure` before the next `allowRequest`.
   *
   * @param now - Current epoch ms.
   */
  allowRequest(now: number): boolean {
    if (this._state === 'open') {
      const elapsed = this._lastFailAt === null ? Infinity : now - this._lastFailAt;
      if (elapsed >= this.resetTimeoutMs) {
        this._state = 'half_open';
        return true;
      }
      return false;
    }
    // closed → always allow; half_open → allow the single trial.
    return true;
  }

  /** Record a successful forward at `now`: closes the breaker + resets the counter. */
  recordSuccess(now: number): void {
    this._state = 'closed';
    this._failCount = 0;
    this._lastSuccessAt = now;
  }

  /**
   * Record a failed forward at `now`. From `half_open` a single failure
   * re-opens immediately; from `closed` the breaker opens once the consecutive
   * failure count reaches the threshold.
   */
  recordFailure(now: number): void {
    this._failCount += 1;
    this._lastFailAt = now;
    if (this._state === 'half_open' || this._failCount >= this.failureThreshold) {
      this._state = 'open';
    }
  }

  /**
   * Read the state the breaker WOULD be in at `now` without permitting a trial
   * (the open→half_open elapse is reflected, but no trial is consumed). For
   * admin/debug surfaces (`/api/analytics-debug`).
   */
  peek(now: number): CircuitState {
    if (
      this._state === 'open' &&
      this._lastFailAt !== null &&
      now - this._lastFailAt >= this.resetTimeoutMs
    ) {
      return 'half_open';
    }
    return this._state;
  }

  /** The raw current state (no time transition applied). */
  get state(): CircuitState {
    return this._state;
  }

  /** Whether the breaker is currently tripped open (raw, no elapse check). */
  isOpen(): boolean {
    return this._state === 'open';
  }

  /** Serialise for persistence. */
  snapshot(): CircuitBreakerSnapshot {
    return {
      state: this._state,
      failCount: this._failCount,
      lastFailAt: this._lastFailAt,
      lastSuccessAt: this._lastSuccessAt,
    };
  }
}
