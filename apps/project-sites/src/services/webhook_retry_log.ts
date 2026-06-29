/**
 * @module services/webhook_retry_log
 * @description Pure-function retry-log accumulator for outbound webhook
 * deliveries.  Records each delivery attempt as an immutable entry and
 * produces summary statistics for monitoring and alerting.
 *
 * Zero side-effects — safe to call from cron, API handlers, or tests
 * without mocking.
 *
 * ## Entry shape
 *
 * Every {@link RetryLogEntry} records one delivery attempt:
 *
 * | Field       | Description                                      |
 * | ----------- | ------------------------------------------------ |
 * | `webhookId` | Stable identifier of the outbound webhook target  |
 * | `attempt`   | 1-based attempt number for this webhook delivery  |
 * | `status`    | Delivery outcome: `"delivered"` or `"failed"`     |
 * | `error`     | Error message when `status === "failed"`; `null`  |
 * | `ts`        | ISO 8601 timestamp of the attempt                 |
 */

/** A single outbound-webhook delivery attempt. */
export interface RetryLogEntry {
  /** Stable identifier of the outbound webhook target. */
  readonly webhookId: string;
  /** 1-based attempt number for this webhook delivery. */
  readonly attempt: number;
  /** Delivery outcome — `"delivered"` or `"failed"`. */
  readonly status: string;
  /** Error message when `status === "failed"`; `null` on success. */
  readonly error: string | null;
  /** ISO 8601 UTC timestamp of the delivery attempt. */
  readonly ts: string;
}

/** Aggregate retry statistics for a set of webhook delivery attempts. */
export interface RetryStats {
  /** Total number of recorded attempts. */
  readonly total: number;
  /** Number of attempts with status `"delivered"`. */
  readonly delivered: number;
  /** Number of attempts with status `"failed"`. */
  readonly failed: number;
  /**
   * Percentage of attempts that were delivered, rounded to one decimal
   * place.  When `total === 0` the value is `100.0` (no failures means
   * a clean slate).
   */
  readonly pctSuccess: number;
}

/**
 * Append a delivery attempt to the retry log.
 *
 * Returns a **new array** with the given entry appended.  The input
 * array is never mutated.
 *
 * @param entries - Existing retry-log entries (read — never mutated).
 * @param entry   - The delivery attempt to record.
 * @returns A new array containing all prior entries plus the new one.
 *
 * @example
 * const entry: RetryLogEntry = {
 *   webhookId: 'wh_abc',
 *   attempt:   1,
 *   status:    'delivered',
 *   error:     null,
 *   ts:        '2026-06-29T12:00:00.000Z',
 * };
 * const log = logAttempt([], entry);
 * // log.length === 1
 * // log[0].status === 'delivered'
 *
 * @example
 * const a = logAttempt([], {
 *   webhookId: 'wh_abc', attempt: 1, status: 'failed',
 *   error: 'ECONNREFUSED', ts: '2026-06-29T12:00:00.000Z',
 * });
 * const b = logAttempt(a, {
 *   webhookId: 'wh_abc', attempt: 2, status: 'delivered',
 *   error: null, ts: '2026-06-29T12:01:00.000Z',
 * });
 * // a has length 1, b has length 2 — a is unchanged
 */
export function logAttempt(
  entries: readonly RetryLogEntry[],
  entry: RetryLogEntry,
): RetryLogEntry[] {
  return [...entries, entry];
}

/**
 * Compute delivery statistics across a set of retry-log entries.
 *
 * Counts delivered vs failed attempts and derives the success
 * percentage.  An empty input yields `{ total: 0, delivered: 0,
 * failed: 0, pctSuccess: 100.0 }` — zero failures means the system
 * has a clean slate.
 *
 * @param entries - Retry-log entries to summarise.
 * @returns Aggregate statistics.
 *
 * @example
 * const now = '2026-06-29T12:00:00.000Z';
 * const log = [
 *   { webhookId: 'wh_a', attempt: 1, status: 'delivered', error: null,  ts: now },
 *   { webhookId: 'wh_b', attempt: 1, status: 'failed',    error: 'ECONNREFUSED', ts: now },
 *   { webhookId: 'wh_b', attempt: 2, status: 'delivered', error: null,  ts: now },
 * ];
 * retryStats(log);
 * // { total: 3, delivered: 2, failed: 1, pctSuccess: 66.7 }
 *
 * @example
 * retryStats([]);
 * // { total: 0, delivered: 0, failed: 0, pctSuccess: 100.0 }
 */
export function retryStats(entries: readonly RetryLogEntry[]): RetryStats {
  let delivered = 0;
  let failed = 0;

  for (const entry of entries) {
    if (entry.status === 'delivered') {
      delivered++;
    } else {
      failed++;
    }
  }

  const total = delivered + failed;
  const pctSuccess = total === 0 ? 100.0 : Math.round((delivered / total) * 1000) / 10;

  return { delivered, failed, total, pctSuccess };
}
