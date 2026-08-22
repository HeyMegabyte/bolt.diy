/**
 * @module services/webhook_monitor
 * @description Pure-function webhook delivery monitor — records delivery
 * events, summarises aggregate statistics, and surfaces endpoints whose
 * failure rate exceeds a configurable threshold. Zero side-effects — safe to
 * call from cron, API handlers, or tests without mocking.
 * @packageDocumentation
 */

export interface DeliveryEvent {
  readonly webhookId: string;
  readonly url: string;
  readonly status: 'delivered' | 'failed';
  /** HTTP status code from the attempt (`0` for a network-level failure). */
  readonly statusCode: number;
  readonly error: string | null;
  /** ISO 8601 UTC timestamp of the delivery attempt. */
  readonly ts: string;
}

export interface DeliveryStats {
  readonly total: number;
  readonly delivered: number;
  readonly failed: number;
  /** Overall failure rate, rounded to three decimals; `0` when `total === 0`. */
  readonly overallFailureRate: number;
  readonly byEndpoint: readonly EndpointStats[];
}

export interface EndpointStats {
  readonly webhookId: string;
  readonly url: string;
  readonly total: number;
  readonly delivered: number;
  readonly failed: number;
  /** Failure rate for this endpoint, rounded to three decimals; `0` when `total === 0`. */
  readonly failureRate: number;
}

export interface FailingEndpoint {
  readonly webhookId: string;
  readonly url: string;
  readonly total: number;
  readonly failed: number;
  /** Rounded to three decimals. Always greater than the threshold that triggered this report. */
  readonly failureRate: number;
}

/**
 * Record a delivery event. When `ts` is omitted the current time is used. The
 * input is never mutated.
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
 * Compute aggregate delivery statistics across a set of events, with a
 * per-endpoint breakdown. The input array is never mutated.
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
        delivered: existing.delivered + (isDelivered ? 1 : 0),
        failed: existing.failed + (isDelivered ? 0 : 1),
        failureRate: computeFailureRate(
          existing.failed + (isDelivered ? 0 : 1),
          existing.total + 1,
        ),
        total: existing.total + 1,
      });
    } else {
      const failed = isDelivered ? 0 : 1;
      endpointMap.set(event.webhookId, {
        delivered: isDelivered ? 1 : 0,
        failed,
        failureRate: computeFailureRate(failed, 1),
        total: 1,
        url: event.url,
        webhookId: event.webhookId,
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
 * Identify endpoints whose failure rate exceeds `threshold` (a decimal 0–1,
 * e.g. `0.5` for 50%), sorted by failure rate descending. An empty input or a
 * threshold of `1` yields `[]`. The input array is never mutated.
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

  result.sort((a, b) => b.failureRate - a.failureRate);

  return result;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function computeFailureRate(failed: number, total: number): number {
  return total === 0 ? 0 : round3(failed / total);
}
