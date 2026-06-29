/**
 * @module services/webhook_dlq
 * @description Dead-letter queue management for outbound webhook deliveries.
 *
 * Pure functions — no I/O, no side-effects. Operates on in-memory
 * {@link DeadLetterEntry} records to track which deliveries have been
 * permanently failed, allow selective replay, and provide aggregate
 * visibility into the depth and health of the dead-letter queue.
 *
 * ## Entry lifecycle
 *
 * ```
 * delivery fails → deadLetter(entry, reason) → DeadLetterEntry
 *                                                    │
 *                     replayDead(entry) ←────────────┤
 *                     (resets for a fresh retry cycle)
 *
 * dlqStats(entries) → { total, replayable, dead }
 * ```
 *
 * @packageDocumentation
 */

/**
 * A permanently-failed webhook delivery stored in the dead-letter queue.
 *
 * Every entry carries the original delivery context (which endpoint+event
 * failed) plus a reason-based classification — "why this can't proceed".
 */
export interface DeadLetterEntry {
  /** Stable identifier of the outbound webhook endpoint. */
  readonly webhookId: string;
  /** The target URL that rejected the delivery. */
  readonly url: string;
  /** The event type that triggered this delivery attempt. */
  readonly eventType: string;
  /** Number of delivery attempts made before dead-lettering. */
  readonly attempts: number;
  /** HTTP status code from the last attempt (`0` for a network-level failure). */
  readonly lastStatusCode: number;
  /** Error message from the last failed attempt, or `null` if none. */
  readonly lastError: string | null;
  /** ISO 8601 UTC timestamp of when this entry was dead-lettered. */
  readonly deadLetterTs: string;
  /**
   * Classification of why the delivery was dead-lettered.
   *
   * - `exhausted_retries` — hit the max-attempt ceiling with transient failures
   * - `permanent_4xx` — endpoint returned a non-429 client error (bad URL, auth)
   * - `unsafe_url` — blocked by the SSRF guard (internal/loopback target)
   * - `sign_error` — failed to decrypt or HMAC-sign the payload
   * - `manual` — explicitly moved to DLQ by an operator via replayDead or admin action
   */
  readonly deadLetterReason: DeadLetterReason;
}

/** Known reasons a webhook enters the dead-letter queue. */
export type DeadLetterReason =
  | 'exhausted_retries'
  | 'permanent_4xx'
  | 'unsafe_url'
  | 'sign_error'
  | 'manual';

/** All recognised dead-letter reasons. Frozen — safe for iteration and inclusion checks. */
export const DEAD_LETTER_REASONS: readonly DeadLetterReason[] = Object.freeze([
  'exhausted_retries',
  'permanent_4xx',
  'unsafe_url',
  'sign_error',
  'manual',
]);

/**
 * Aggregate statistics across a set of dead-letter entries.
 */
export interface DlqStats {
  /** Total number of entries in the set. */
  readonly total: number;
  /**
   * Entries whose `deadLetterReason` indicates a transient or operator-reversible
   * failure — the endpoint or network may have recovered. These are eligible for
   * {@link replayDead}.
   */
  readonly replayable: number;
  /**
   * Entries whose `deadLetterReason` indicates a permanent, non-recoverable failure
   * (bad URL, auth, unsafe host) — replaying would produce the same outcome.
   */
  readonly dead: number;
}

/**
 * Reasons that are considered **replayable** — the underlying issue MAY have
 * resolved (network restored, endpoint fixed, secrets rotated). Entries with
 * these reasons are counted in `dlqStats.replayable`.
 */
export const REPLAYABLE_REASONS: ReadonlySet<DeadLetterReason> = new Set<DeadLetterReason>([
  'exhausted_retries',
  'sign_error',
  'manual',
]);

/**
 * Reasons that are considered **permanently dead** — replaying will produce the
 * same outcome. Entries with these reasons are counted in `dlqStats.dead`.
 */
export const DEAD_REASONS: ReadonlySet<DeadLetterReason> = new Set<DeadLetterReason>([
  'permanent_4xx',
  'unsafe_url',
]);

/**
 * Promote a failed webhook delivery to the dead-letter queue.
 *
 * Wraps the delivery context with a reason and a timestamp, producing an
 * immutable {@link DeadLetterEntry}. The original entry is never mutated.
 *
 * @param webhookId - Stable identifier of the webhook endpoint that failed.
 * @param url - The target URL.
 * @param eventType - The event type that triggered this delivery.
 * @param attempts - Number of prior delivery attempts.
 * @param lastStatusCode - HTTP status from the last attempt (`0` for network error).
 * @param lastError - Error message from the last attempt, or `null`.
 * @param deadLetterReason - Classification of why the entry is dead-lettered.
 * @param nowIso - ISO 8601 timestamp override (defaults to `new Date().toISOString()`).
 * @returns A new dead-letter entry.
 *
 * @example
 * ```ts
 * const entry = deadLetter(
 *   'ep_abc123',
 *   'https://example.com/hooks/site-published',
 *   'site.published',
 *   6,
 *   503,
 *   'upstream timeout',
 *   'exhausted_retries',
 *   '2026-06-29T12:00:00.000Z',
 * );
 * // → { webhookId: 'ep_abc123', url: 'https://…', deadLetterTs: '2026-06-29T12:00:00.000Z', … }
 * ```
 *
 * @example
 * ```ts
 * // SSRF-blocked entry — never retry
 * const blocked = deadLetter(
 *   'ep_def', 'http://169.254.169.254/latest/meta-data', 'build.failed',
 *   1, 0, null, 'unsafe_url',
 * );
 * // blocked.deadLetterReason === 'unsafe_url'
 * // dlqStats([blocked]).dead === 1
 * ```
 */
export function deadLetter(
  webhookId: string,
  url: string,
  eventType: string,
  attempts: number,
  lastStatusCode: number,
  lastError: string | null,
  deadLetterReason: DeadLetterReason,
  nowIso?: string,
): DeadLetterEntry {
  const ts = nowIso ?? new Date().toISOString();

  return {
    attempts,
    deadLetterReason,
    deadLetterTs: ts,
    eventType,
    lastError,
    lastStatusCode,
    url,
    webhookId,
  };
}

/**
 * Prepare a dead-letter entry for replay.
 *
 * Resets the delivery state so the entry can be retried with a fresh attempt
 * counter and a `manual` reason. The returned object carries the original
 * endpoint coordinates (`webhookId`, `url`, `eventType`) so the orchestrator
 * can re-insert it into the delivery pipeline.
 *
 * When the entry has a **permanent** dead-letter reason (`permanent_4xx` or
 * `unsafe_url`), the function returns `null` — replaying would produce the
 * same failure outcome and is not supported.
 *
 * @param entry - The dead-letter entry to replay.
 * @param nowIso - ISO 8601 timestamp override for the new dead-letter entry
 *   (defaults to `new Date().toISOString()`).
 * @returns A new dead-letter entry with reset delivery state and reason set
 *   to `manual`, or `null` when the entry is not replayable.
 *
 * @example
 * ```ts
 * const dlq: DeadLetterEntry = {
 *   webhookId: 'ep_abc', url: 'https://example.com/hook', eventType: 'site.published',
 *   attempts: 6, lastStatusCode: 503, lastError: 'upstream timeout',
 *   deadLetterTs: '2026-06-29T12:00:00.000Z', deadLetterReason: 'exhausted_retries',
 * };
 * const replay = replayDead(dlq);
 * // → { ...attempts: 0, lastStatusCode: 0, lastError: null, deadLetterReason: 'manual', … }
 *
 * @example
 * ```ts
 * const permanent: DeadLetterEntry = {
 *   webhookId: 'ep_def', url: 'https://not-real.example.com', eventType: 'build.failed',
 *   attempts: 1, lastStatusCode: 404, lastError: 'Not Found',
 *   deadLetterTs: '2026-06-29T12:00:00.000Z', deadLetterReason: 'permanent_4xx',
 * };
 * replayDead(permanent); // → null
 * ```
 */
export function replayDead(entry: DeadLetterEntry, nowIso?: string): DeadLetterEntry | null {
  if (DEAD_REASONS.has(entry.deadLetterReason)) {
    return null;
  }

  const ts = nowIso ?? new Date().toISOString();

  return {
    attempts: 0,
    deadLetterReason: 'manual',
    deadLetterTs: ts,
    eventType: entry.eventType,
    lastError: null,
    lastStatusCode: 0,
    url: entry.url,
    webhookId: entry.webhookId,
  };
}

/**
 * Compute aggregate statistics over a set of dead-letter entries.
 *
 * Counts total, replayable, and permanently-dead entries. Handles empty,
 * single-entry, and mixed-reason collections.
 *
 * @param entries - The dead-letter entries to summarise.
 * @returns Aggregate statistics.
 *
 * @example
 * ```ts
 * const now = '2026-06-29T12:00:00.000Z';
 * const entries: DeadLetterEntry[] = [
 *   { webhookId: 'ep_a', url: 'https://a.com/hook', eventType: 'site.published',
 *     attempts: 6, lastStatusCode: 503, lastError: 'timeout', deadLetterTs: now,
 *     deadLetterReason: 'exhausted_retries' },
 *   { webhookId: 'ep_b', url: 'https://b.com/hook', eventType: 'form.submitted',
 *     attempts: 1, lastStatusCode: 404, lastError: 'Not Found', deadLetterTs: now,
 *     deadLetterReason: 'permanent_4xx' },
 * ];
 * dlqStats(entries);
 * // → { total: 2, replayable: 1, dead: 1 }
 *
 * @example
 * ```ts
 * dlqStats([]);
 * // → { total: 0, replayable: 0, dead: 0 }
 * ```
 */
export function dlqStats(entries: readonly DeadLetterEntry[]): DlqStats {
  let replayable = 0;
  let dead = 0;

  for (const entry of entries) {
    if (REPLAYABLE_REASONS.has(entry.deadLetterReason)) {
      replayable++;
    } else if (DEAD_REASONS.has(entry.deadLetterReason)) {
      dead++;
    }
  }

  return {
    dead,
    replayable,
    total: replayable + dead,
  };
}
