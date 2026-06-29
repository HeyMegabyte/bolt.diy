/**
 * @module services/quota_alert
 *
 * Pure quota-threshold alert generator. Checks a used/limit pair against
 * the three alert bands (warning, critical, exceeded) and builds a
 * ready-to-email payload for the configured owner. No I/O, no clock
 * side-effects — the caller supplies all numbers.
 */

/** Alert severity when a quota crosses a threshold band. */
export type QuotaStatus = 'ok' | 'warning' | 'critical' | 'exceeded';

/** Threshold percentages that define each alert band. */
export const QUOTA_THRESHOLDS = {
  /** 90%+: urgent — action needed soon. */
  critical: 90,
  /** 100%+: quota exhausted. */
  exceeded: 100,
  /** 75%+: first actionable warning. */
  warning: 75,
} as const;

/** Result of a single quota-status check. */
export interface QuotaStatusResult {
  message: string;
  pctUsed: number;
  status: QuotaStatus;
}

/** Ready-to-email alert payload. */
export interface QuotaAlertPayload {
  body: string;
  shouldSend: boolean;
  subject: string;
}

/**
 * Check a single used/limit pair against the threshold bands. Pure — no I/O,
 * returns the same output for the same inputs every time.
 *
 * @param used  - Amount consumed so far (clamped to 0).
 * @param limit - Total allotment (clamped to 0; when 0, no limit is enforced).
 * @returns `{ status, pctUsed, message }` — `pctUsed` is always ≥0; `status` is
 *          `ok` when limit ≤ 0 or `pctUsed < warning`.
 *
 * @example
 * ```ts
 * checkQuotaStatus(80, 100);
 * // { status: 'critical', pctUsed: 80, message: 'Quota at 80% (80/100) — critical' }
 * ```
 *
 * @example
 * ```ts
 * checkQuotaStatus(50, 0);
 * // { status: 'ok', pctUsed: 0, message: 'Quota at 0% — no limit set' }
 * ```
 */
export function checkQuotaStatus(used: number, limit: number): QuotaStatusResult {
  const usedClamped = Math.max(0, used);
  const limitClamped = Math.max(0, limit);
  const pctUsed = limitClamped > 0 ? Math.round((usedClamped / limitClamped) * 100) : 0;

  if (limitClamped <= 0) {
    return { message: `Quota at 0% — no limit set`, pctUsed: 0, status: 'ok' };
  }

  if (pctUsed >= QUOTA_THRESHOLDS.exceeded) {
    return {
      message: `Quota exceeded at ${pctUsed}% (${usedClamped}/${limitClamped}) — action required`,
      pctUsed,
      status: 'exceeded',
    };
  }

  if (pctUsed >= QUOTA_THRESHOLDS.critical) {
    return {
      message: `Quota at ${pctUsed}% (${usedClamped}/${limitClamped}) — critical`,
      pctUsed,
      status: 'critical',
    };
  }

  if (pctUsed >= QUOTA_THRESHOLDS.warning) {
    return {
      message: `Quota at ${pctUsed}% (${usedClamped}/${limitClamped}) — warning`,
      pctUsed,
      status: 'warning',
    };
  }

  return {
    message: `Quota at ${pctUsed}% (${usedClamped}/${limitClamped}) — healthy`,
    pctUsed,
    status: 'ok',
  };
}

/**
 * Build a human-readable alert payload for a quota crossing a threshold.
 * `shouldSend` is `false` when status is `ok` or below the warning band,
 * so the caller can skip sending.
 *
 * @param type       - Short label describing what is being counted (e.g. "API calls").
 * @param used       - Amount consumed so far (clamped to 0).
 * @param limit      - Total allotment (clamped to 0).
 * @param ownerEmail - Recipient for the alert.
 * @returns `{ subject, body, shouldSend }` — `body` is a plain-text email body.
 *
 * @example
 * ```ts
 * buildQuotaAlert('API calls', 95, 100, 'ops@example.com');
 * // { subject: '[projectsites] Quota Alert — API calls', body: '…', shouldSend: true }
 * ```
 */
export function buildQuotaAlert(
  type: string,
  used: number,
  limit: number,
  ownerEmail: string,
): QuotaAlertPayload {
  const { message, pctUsed, status } = checkQuotaStatus(used, limit);

  if (status === 'ok') {
    return { body: '', shouldSend: false, subject: '' };
  }

  const label = type || 'Resource';
  const subject = `[projectsites] Quota Alert — ${label}`;
  const body = [
    `Quota alert for: ${label}`,
    `Status:       ${status.toUpperCase()}`,
    `Usage:        ${pctUsed}% (${Math.max(0, used)}/${Math.max(0, limit)})`,
    `Owner:        ${ownerEmail}`,
    ``,
    message,
    ``,
    `Please review and take action before the quota is fully exhausted.`,
  ].join('\n');

  return { body, shouldSend: true, subject };
}
