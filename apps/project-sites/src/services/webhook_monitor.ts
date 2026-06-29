/**
 * @module services/webhook_monitor
 * @description Pure-function webhook delivery monitor.  Records delivery
 * events, summarises aggregate delivery statistics, and surfaces endpoints
 * whose failure rate exceeds a configurable threshold.
 *
 * Zero side-effects — safe to call from cron, API handlers, or tests
 * without mocking.
 *
 * ## Entry shape
 *
 * Every {@link DeliveryEvent} records one delivery attempt:
 *
 * | Field        | Description                                        |
 * | ------------ | -------------------------------------------------- |
 * | `webhookId`  | Stable identifier of the outbound webhook target    |
 * | `url`        | The target URL                                     |
 * | `status`     | Delivery outcome: `"delivered"` or `"failed"`       |
 * | `statusCode` | HTTP status code (`0` for network-level failure)    |
 * | `error`      | Error message when `status === "failed"`; `null`    |
 * | `ts`         | ISO 8601 UTC timestamp of the delivery attempt      |
 *
 * @packageDocumentation
 */

/** A single outbound-webhook delivery event. */
export interface DeliveryEvent {
  /** Stable identifier of the outbound webhook target. */
  readonly webhookId: string;
  /** The target URL that received (or rejected) the delivery. */
  readonly url: string;
  /** Delivery outcome — `"delivered"` or `"failed"`. */
  readonly status: 'delivered' | 'failed';
  /** HTTP status code from the attempt (`0` for a network-level failure). */
  readonly statusCode: number;
  /** Error message when `status === "failed"`; `null` on success. */
  readonly error: string | null;
  /** ISO 8601 UTC timestamp of the delivery attempt. */
  readonly ts: string;
}

/** Aggregate delivery statistics across a set of events, including per-endpoint breakdown. */
export interface DeliveryStats {
  /** Total number of recorded delivery events. */
  readonly total: number;
  /** Number of events with status `"delivered"`. */
  readonly delivered: number;
  /** Number of events with status `"failed"`. */
  readonly failed: number;
  /**
   * Overall failure rate, rounded to three decimal places.  When
   * `total === 0` the value is `0`.
   */
  readonly overallFailureRate: number;
  /** Per-endpoint breakdown of delivery statistics. */
  readonly byEndpoint: readonly EndpointStats[];
}

/** Per-endpoint delivery statistics. */
export interface EndpointStats {
  /** Stable identifier of the outbound webhook target. */
  readonly webhookId: string;
  /** The target URL. */
  readonly url: string;
  /** Total delivery attempts for this endpoint. */
  readonly total: number;
  /** Successful deliveries for this endpoint. */
  readonly delivered: number;
  /** Failed deliveries for this endpoint. */
  readonly failed: number;
  /**
   * Failure rate for this endpoint, rounded to three decimal places.
   * When `total === 0` the value is `0`.
   */
  readonly failureRate: number;
}

/** An endpoint whose failure rate exceeds the configured threshold. */
export interface FailingEndpoint {
  /** Stable identifier of the outbound webhook target. */
  readonly webhookId: string;
  /** The target URL. */
  readonly url: string;
  /** Total delivery attempts for this endpoint. */
  readonly total: number;
  /** Failed deliveries for this endpoint. */
  readonly failed: number;
  /**
   * Failure rate for this endpoint, rounded to three decimal places.
   * Always greater than the threshold that triggered this report.
   */
  readonly failureRate: number;
}

/**
 * Record a delivery event.
 *
 * Constructs a complete {@link DeliveryEvent} from the supplied fields.
 * When `ts` is omitted the current time (in ISO 8601) is used.  The
 * input object is never mutated.
 *
 * @param webhookId - Stable identifier of the webhook endpoint.
 * @param url - The target URL.
 * @param status - Delivery outcome — `"delivered"` or `"failed"`.
 * @param statusCode - HTTP status code (`0` for network-level failure).
 * @param error - Error message when `status === "failed"`; `null` on success.
 * @param ts - ISO 8601 timestamp override (defaults to `new Date().toISOString()`).
 * @returns A new delivery event.
 *
 * @example
 * ```ts
 * const ev = trackDelivery(
 *   'wh_abc',
 *   'https://example.com/hooks/site-published',
 *   'delivered',
 *   200,
 *   null,
 *   '2026-06-29T12:00:00.000Z',
 * );
 * // → { webhookId: 'wh_abc', url: 'https://…', status: 'delivered', statusCode: 200, error: null, ts: '2026-06-29T12:00:00.000Z' }
 * ```
 *
 * @example
 * ```ts
 * const failed = trackDelivery(
 *   'wh_def', 'https://example.com/hooks/fail', 'failed', 503, 'upstream timeout',
 * );
 * // failed.ts is set to the current time
 * ```
 */
export function trackDelivery(
  webhookId: string,
  url: string,
  status: 'delivered' | 'failed',
  statusCode: number,
  error: string | null,
  ts?: string,
): DeliveryEvent {
  return {
    error,
    status,
    statusCode,
    ts: ts ?? new Date().toISOString(),
    url,
    webhookId,
  };
}

/**
 * Compute aggregate delivery statistics across a set of events.
 *
 * Returns total, delivered, failed, an overall failure rate, and a
 * per-endpoint breakdown.  Handles empty, single-entry, and mixed-endpoint
 * collections.  The input array is never mutated.
 *
 * @param events - The delivery events to summarise.
 * @returns Aggregate delivery statistics.
 *
 * @example
 * ```ts
 * const now = '2026-06-29T12:00:00.000Z';
 * const events: DeliveryEvent[] = [
 *   { webhookId: 'wh_a', url: 'https://a.com/hook', status: 'delivered', statusCode: 200, error: null, ts: now },
 *   { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'failed', statusCode: 503, error: 'timeout', ts: now },
 *   { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'delivered', statusCode: 200, error: null, ts: now },
 * ];
 * deliveryStats(events);
 * // → { total: 3, delivered: 2, failed: 1, overallFailureRate: 0.333, byEndpoint: [...] }
 *
 * @example
 * ```ts
 * deliveryStats([]);
 * // → { total: 0, delivered: 0, failed: 0, overallFailureRate: 0, byEndpoint: [] }
 * ```
 */
export function deliveryStats(events: readonly DeliveryEvent[]): DeliveryStats {
  const endpointMap = new Map<string, EndpointStats>();

  let totalDelivered = 0;
  let totalFailed = 0;

  for (const event of events) {
    const isDelivered = event.status === 'delivered';
    if (isDelivered) {
      totalDelivered++;
    } else {
      totalFailed++;
    }

    const existing = endpointMap.get(event.webhookId);
    if (existing) {
      endpointMap.set(event.webhookId, {
        ...existing,
        total: existing.total + 1,
        delivered: existing.delivered + (isDelivered ? 1 : 0),
        failed: existing.failed + (isDelivered ? 0 : 1),
        failureRate: computeFailureRate(
          existing.failed + (isDelivered ? 0 : 1),
          existing.total + 1,
        ),
      });
    } else {
      const failed = isDelivered ? 0 : 1;
      endpointMap.set(event.webhookId, {
        webhookId: event.webhookId,
        url: event.url,
        total: 1,
        delivered: isDelivered ? 1 : 0,
        failed,
        failureRate: computeFailureRate(failed, 1),
      });
    }
  }

  const byEndpoint = Array.from(endpointMap.values());

  const total = totalDelivered + totalFailed;
  const overallFailureRate = total === 0 ? 0 : round3(totalFailed / total);

  return {
    byEndpoint,
    delivered: totalDelivered,
    failed: totalFailed,
    overallFailureRate,
    total,
  };
}

/**
 * Identify endpoints whose failure rate exceeds the given threshold.
 *
 * Filters the event set down to endpoints with a failure rate strictly
 * greater than `threshold`.  The threshold is a decimal between 0 and 1
 * (e.g. `0.5` for 50%).  An empty input or a threshold of `1` yields an
 * empty array.  The input array is never mutated.
 *
 * @param events - The delivery events to evaluate.
 * @param threshold - Failure rate threshold (0–1).  Endpoints with a
 *   failure rate strictly greater than this value are returned.
 * @returns An array of {@link FailingEndpoint} entries sorted by failure
 *   rate descending, or an empty array when none exceed the threshold.
 *
 * @example
 * ```ts
 * const now = '2026-06-29T12:00:00.000Z';
 * const events: DeliveryEvent[] = [
 *   { webhookId: 'wh_a', url: 'https://a.com/hook', status: 'delivered', statusCode: 200, error: null, ts: now },
 *   { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'failed', statusCode: 503, error: 'timeout', ts: now },
 *   { webhookId: 'wh_b', url: 'https://b.com/hook', status: 'failed', statusCode: 503, error: 'timeout', ts: now },
 * ];
 * failingEndpoints(events, 0.5);
 * // → [{ webhookId: 'wh_b', url: 'https://b.com/hook', total: 2, failed: 2, failureRate: 1.0 }]
 *
 * @example
 * ```ts
 * failingEndpoints([], 0.5);
 * // → []
 * ```
 */
export function failingEndpoints(
  events: readonly DeliveryEvent[],
  threshold: number,
): readonly FailingEndpoint[] {
  if (events.length === 0 || threshold >= 1) {
    return [];
  }

  const stats = deliveryStats(events);
  const result: FailingEndpoint[] = [];

  for (const ep of stats.byEndpoint) {
    if (ep.failureRate > threshold) {
      result.push({
        failed: ep.failed,
        failureRate: ep.failureRate,
        total: ep.total,
        url: ep.url,
        webhookId: ep.webhookId,
      });
    }
  }

  // Sort descending by failure rate
  result.sort((a, b) => b.failureRate - a.failureRate);

  return result;
}

/**
 * Round a number to three decimal places.
 *
 * @param n - The number to round.
 * @returns The rounded value.
 */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Compute the failure rate given a failed count and total count.
 *
 * @param failed - Number of failed attempts.
 * @param total  - Total number of attempts.
 * @returns The failure rate rounded to three decimal places, or `0` when total is `0`.
 */
function computeFailureRate(failed: number, total: number): number {
  return total === 0 ? 0 : round3(failed / total);
}
