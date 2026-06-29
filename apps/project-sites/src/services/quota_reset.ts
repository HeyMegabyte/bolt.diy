/**
 * @module services/quota_reset
 *
 * @description
 * Pure monthly-quota reset helpers. Determines whether a 30-day billing period
 * has elapsed, resets counters when it has, and reports summary stats. No I/O,
 * no clock side-effects — the caller supplies all timestamps.
 *
 * @see services/quota_manager.ts     — Quota / QuotaCheck / QuotaSummary types
 * @see services/build_quota.ts       — BuildQuota with periodStartMs pattern
 * @see services/quota_alert.ts       — QuotaStatus / QuotaAlertPayload types
 */

/** MONTHLY duration in milliseconds used for billing-period calculations. */
const MS_IN_30_DAYS = 30 * 24 * 60 * 60 * 1000;

/** A quota snapshot that carries its billing-period start timestamp. */
export interface QuotaWithPeriod {
  readonly type: string;
  readonly limit: number;
  readonly used: number;
  readonly periodStartMs: number;
}

/** Summary of reset state across a set of quotas. */
export interface QuotaResetSummary {
  readonly nextReset: number;
  readonly resetCount: number;
}

/**
 * Return the number of full calendar days remaining in the current month.
 * e.g. June 26 → 4  (Jun 27, 28, 29, 30).
 *
 * @param nowMs - Epoch ms for which to compute the remaining days.
 * @returns Days left in the month (0 when today is the last day).
 *
 * @example
 * ```ts
 * daysUntilReset(new Date('2026-06-26T12:00:00Z').getTime());
 * // => 4
 * ```
 */
export function daysUntilReset(nowMs: number): number {
  const d = new Date(nowMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return lastDay - d.getUTCDate();
}

/**
 * Reset monthly counters for any quota whose 30-day billing period has
 * elapsed. Resets `used` to 0 and sets `periodStartMs` to midnight on the
 * 1st of the current month. Pure — returns a **new** array, never mutates
 * the input.
 *
 * @param quotas - Array of QuotaWithPeriod to evaluate.
 * @param nowMs  - Epoch ms used as the "current time" for expiry checks.
 * @returns A new array with per-quota resets applied; malformed entries
 *          are passed through unchanged.
 *
 * @example
 * ```ts
 * const quotas = [
 *   { type: 'builds', limit: 5, used: 3, periodStartMs: Date.UTC(2026, 4, 1) },
 *   { type: 'ai_calls', limit: 10, used: 0, periodStartMs: Date.UTC(2026, 5, 1) },
 * ];
 * const reset = resetQuotas(quotas, Date.UTC(2026, 5, 5));
 * // quotas[0] is reset (30 days elapsed); quotas[1] is unchanged
 * ```
 */
export function resetQuotas(quotas: QuotaWithPeriod[], nowMs: number): QuotaWithPeriod[] {
  const qs = Array.isArray(quotas) ? quotas : [];
  return qs.map((q) => {
    if (!q || typeof q.periodStartMs !== 'number' || typeof q.limit !== 'number') {
      return q;
    }
    if (nowMs >= q.periodStartMs + MS_IN_30_DAYS) {
      const d = new Date(nowMs);
      const newPeriodStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getTime();
      return { ...q, used: 0, periodStartMs: newPeriodStart };
    }
    return q;
  });
}

/**
 * Summarise a set of quotas: count how many have `used === 0` (reset) and
 * find the earliest upcoming period-end timestamp in epoch ms.
 *
 * @param quotas - Array of QuotaWithPeriod to summarise.
 * @returns `{ resetCount, nextReset }` — `nextReset` is `0` when the
 *          array is empty or contains no valid entries.
 *
 * @example
 * ```ts
 * const quotas = [
 *   { type: 'builds',   limit: 5, used: 0, periodStartMs: 1747785600000 },
 *   { type: 'ai_calls', limit: 10, used: 2, periodStartMs: 1747785600000 },
 * ];
 * quotaResetSummary(quotas);
 * // => { resetCount: 1, nextReset: 1747785600000 + 30 * 24 * 60 * 60 * 1000 }
 * ```
 */
export function quotaResetSummary(quotas: QuotaWithPeriod[]): QuotaResetSummary {
  const qs = Array.isArray(quotas) ? quotas : [];
  let resetCount = 0;
  let earliestReset = Infinity;

  for (const q of qs) {
    if (!q || typeof q.periodStartMs !== 'number') continue;
    if (q.used === 0) resetCount++;
    const periodEnd = q.periodStartMs + MS_IN_30_DAYS;
    if (periodEnd < earliestReset) earliestReset = periodEnd;
  }

  return { nextReset: earliestReset === Infinity ? 0 : earliestReset, resetCount };
}
