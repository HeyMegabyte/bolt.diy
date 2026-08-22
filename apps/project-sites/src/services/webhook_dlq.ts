/**
 * @module services/webhook_dlq
 * @description Dead-letter queue management for outbound webhook deliveries.
 * Pure functions — no I/O, no side-effects.
 * @packageDocumentation
 */

export interface DeadLetterEntry {
  readonly webhookId: string;
  readonly url: string;
  readonly eventType: string;
  readonly attempts: number;
  /** HTTP status code from the last attempt (`0` for a network-level failure). */
  readonly lastStatusCode: number;
  readonly lastError: string | null;
  readonly deadLetterTs: string;
  /**
   * Why the delivery was dead-lettered.
   *
   * - `exhausted_retries` — hit the max-attempt ceiling with transient failures
   * - `permanent_4xx` — endpoint returned a non-429 client error (bad URL, auth)
   * - `unsafe_url` — blocked by the SSRF guard (internal/loopback target)
   * - `sign_error` — failed to decrypt or HMAC-sign the payload
   * - `manual` — explicitly moved to DLQ by an operator via replayDead or admin action
   */
  readonly deadLetterReason: DeadLetterReason;
}

export type DeadLetterReason =
  | 'exhausted_retries'
  | 'permanent_4xx'
  | 'unsafe_url'
  | 'sign_error'
  | 'manual';

/** Frozen — safe for iteration and inclusion checks. */
export const DEAD_LETTER_REASONS: readonly DeadLetterReason[] = Object.freeze([
  'exhausted_retries',
  'permanent_4xx',
  'unsafe_url',
  'sign_error',
  'manual',
]);

export interface DlqStats {
  readonly total: number;
  readonly replayable: number;
  readonly dead: number;
}

/**
 * Reasons that are **replayable** — the underlying issue MAY have resolved
 * (network restored, endpoint fixed, secrets rotated). Counted in `dlqStats.replayable`.
 */
export const REPLAYABLE_REASONS: ReadonlySet<DeadLetterReason> = new Set<DeadLetterReason>([
  'exhausted_retries',
  'sign_error',
  'manual',
]);

/**
 * Reasons that are **permanently dead** — replaying produces the same outcome.
 * Counted in `dlqStats.dead`.
 */
export const DEAD_REASONS: ReadonlySet<DeadLetterReason> = new Set<DeadLetterReason>([
  'permanent_4xx',
  'unsafe_url',
]);

/**
 * Promote a failed webhook delivery to the dead-letter queue. The original entry
 * is never mutated.
 *
 * @param nowIso - ISO 8601 timestamp override (defaults to `new Date().toISOString()`).
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
 * ```
 *
 * @example
 * ```ts
 * // SSRF-blocked entry — never retry
 * const blocked = deadLetter(
 *   'ep_def', 'http://169.254.169.254/latest/meta-data', 'build.failed',
 *   1, 0, null, 'unsafe_url',
 * );
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
 * Prepare a dead-letter entry for replay — resets delivery state (fresh attempt
 * counter, `manual` reason) while carrying the original endpoint coordinates so
 * the orchestrator can re-insert it into the delivery pipeline.
 *
 * Returns `null` for a **permanent** reason (`permanent_4xx` / `unsafe_url`) —
 * replaying would produce the same failure and is not supported.
 *
 * @param nowIso - ISO 8601 timestamp override (defaults to `new Date().toISOString()`).
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
