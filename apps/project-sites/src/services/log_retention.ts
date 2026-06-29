/**
 * @module services/log_retention
 * @description Pure retention-policy logic for five log types: audit, analytics,
 * webhook, error, and access. Exposes a factory, an expiry check, and a default
 * configuration. Fully testable — no I/O.
 */

/** The five log categories that carry a retention policy. */
export type LogType = 'audit' | 'analytics' | 'webhook' | 'error' | 'access';

/** How long a given log type is retained and whether it is also archived. */
export interface RetentionPolicy {
  readonly logType: LogType;
  /** Primary retention period, in days. Logs older than this should be purged. */
  readonly retainDays: number;
  /**
   * Optional secondary threshold, in days, after which the log is moved to
   * cold storage before final deletion. `null` when archive is not supported.
   */
  readonly archiveAfterDays: number | null;
}

/** Default retention policies (in days) for every log type. */
function freezePolicy(p: RetentionPolicy): RetentionPolicy {
  return Object.freeze(p);
}

export const DEFAULT_RETENTION: Record<LogType, RetentionPolicy> = Object.freeze({
  audit: freezePolicy({ logType: 'audit', retainDays: 365, archiveAfterDays: 730 }),
  analytics: freezePolicy({ logType: 'analytics', retainDays: 90, archiveAfterDays: null }),
  webhook: freezePolicy({ logType: 'webhook', retainDays: 30, archiveAfterDays: 365 }),
  error: freezePolicy({ logType: 'error', retainDays: 90, archiveAfterDays: 365 }),
  access: freezePolicy({ logType: 'access', retainDays: 30, archiveAfterDays: null }),
});

/**
 * Creates a typed `RetentionPolicy` with defaults for the optional
 * `archiveAfterDays` parameter.
 *
 * @param logType - The log category.
 * @param retainDays - Primary retention period, in days. Must be ≥ 1.
 * @param archiveAfterDays - Optional archive threshold. Defaults to `null`.
 * @returns A frozen `RetentionPolicy` object.
 * @throws {RangeError} When `retainDays < 1`.
 *
 * @example
 * buildPolicy('audit', 365, 730)
 * // => { logType: 'audit', retainDays: 365, archiveAfterDays: 730 }
 *
 * @example
 * buildPolicy('access', 30)
 * // => { logType: 'access', retainDays: 30, archiveAfterDays: null }
 */
export function buildPolicy(
  logType: LogType,
  retainDays: number,
  archiveAfterDays?: number | null,
): RetentionPolicy {
  if (!Number.isInteger(retainDays) || retainDays < 1) {
    throw new RangeError(`retainDays must be a positive integer, got ${retainDays}`);
  }

  const archive = archiveAfterDays !== undefined ? archiveAfterDays : null;

  if (archive !== null && (!Number.isInteger(archive) || archive <= retainDays)) {
    throw new RangeError(
      `archiveAfterDays (${archive}) must be ≥ retainDays (${retainDays}) when set`,
    );
  }

  return Object.freeze({ logType, retainDays, archiveAfterDays: archive });
}

const MS_PER_DAY = 86_400_000;

/**
 * Determines whether a log entry with the given `logDate` has exceeded the
 * primary retention window defined by `policy`.
 *
 * @param policy - The retention policy to check against.
 * @param logDate - ISO-8601 date string or a date-only string (e.g. `"2026-03-15"`)
 *                  representing when the log was created.
 * @param nowMs - Optional reference timestamp (epoch ms). Defaults to `Date.now()`.
 * @returns `true` when the log is older than `policy.retainDays`.
 *
 * @example
 * isExpired(
 *   DEFAULT_RETENTION.audit,
 *   '2025-01-01',
 *   new Date('2026-06-29').getTime(),
 * )
 * // => false (365 days have not passed)
 *
 * @example
 * isExpired(
 *   DEFAULT_RETENTION.access,
 *   '2026-05-01',
 *   new Date('2026-06-29').getTime(),
 * )
 * // => true (59 days > 30-day window)
 */
export function isExpired(policy: RetentionPolicy, logDate: string, nowMs?: number): boolean {
  const ref = nowMs ?? Date.now();
  const dateMs = new Date(logDate).getTime();

  // Treat an unparseable date as expired so the caller can safely purge
  // malformed rows without blocking.
  if (Number.isNaN(dateMs)) return true;

  const elapsed = ref - dateMs;
  return elapsed > policy.retainDays * MS_PER_DAY;
}
