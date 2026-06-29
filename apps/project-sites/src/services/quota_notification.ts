/**
 * @module services/quota_notification
 * @description Pure, deterministic quota-threshold notification builder.
 * Assembles email-ready QuotaNotification objects when a resource (API calls,
 * storage, seats) crosses 80%, 90%, or 100% of its limit. Returns null below
 * 80% — the caller decides whether to log the null or skip the send.
 *
 * @packageDocumentation
 */

/** The tier boundaries that trigger a notification. */
export type QuotaThreshold = 80 | 90 | 100;

/** A fully-assembled notification ready for an email send. */
export interface QuotaNotification {
  /** The resource type being tracked (e.g. "api_calls", "storage_gb"). */
  type: string;
  /** Current usage count (raw unit). */
  used: number;
  /** Maximum allowed count. */
  limit: number;
  /** Usage as a percentage of limit (0-100). */
  pctUsed: number;
  /** The threshold that was crossed (80, 90, or 100). */
  threshold: QuotaThreshold;
  /** Recipient email address. */
  email: string;
  /** Email subject line. */
  subject: string;
  /** Email body (plain text). */
  body: string;
}

/**
 * Threshold for the first warning tier.
 * Crossed when pctUsed >= 80.
 */
export const THRESHOLD_WARN = 80 as const satisfies QuotaThreshold;

/**
 * Threshold for the second warning tier.
 * Crossed when pctUsed >= 90.
 */
export const THRESHOLD_CRITICAL = 90 as const satisfies QuotaThreshold;

/**
 * Threshold for the hard cap tier.
 * Crossed when pctUsed >= 100.
 */
export const THRESHOLD_EXHAUSTED = 100 as const satisfies QuotaThreshold;

/** Ordered list from most-severe to least for comparison. */
const THRESHOLDS: readonly QuotaThreshold[] = [
  THRESHOLD_EXHAUSTED,
  THRESHOLD_CRITICAL,
  THRESHOLD_WARN,
];

/**
 * Determine the highest notification tier for a given usage percentage.
 * Returns null when usage is below the lowest threshold (80%).
 *
 * @param pctUsed - Usage as a percentage (0-100). Values above 100 are
 *   treated as 100; negative values are clamped to 0.
 * @returns The highest matching {@link QuotaThreshold}, or null.
 *
 * @example
 * notificationTier(50)   // => null
 * notificationTier(85)   // => 80
 * notificationTier(95)   // => 90
 * notificationTier(100)  // => 100
 * notificationTier(150)  // => 100
 */
export function notificationTier(pctUsed: number): QuotaThreshold | null {
  const clamped = Math.min(100, Math.max(0, pctUsed));
  for (const t of THRESHOLDS) {
    if (clamped >= t) return t;
  }
  return null;
}

/**
 * Build a {@link QuotaNotification} when usage crosses a threshold, or null
 * when usage is below the 80% floor. Pure + deterministic — never throws.
 *
 * Subject and body use plain-English descriptions so callers can email them
 * directly or pass through a template renderer.
 *
 * @param type - The resource type label (e.g. "API calls", "Storage").
 * @param used - Current usage in raw units.
 * @param limit - Maximum allowed in raw units. Must be > 0.
 * @param email - Recipient email address.
 * @returns A {@link QuotaNotification} or null when usage < 80%.
 *
 * @example
 * buildNotification('API calls', 850, 1000, 'admin@example.com');
 * // => { type: 'API calls', used: 850, limit: 1000, pctUsed: 85,
 * //      threshold: 80, email: 'admin@example.com',
 * //      subject: '⚠️ API calls at 85% capacity',
 * //      body: 'API calls usage is at 85% (850/1000).' }
 *
 * buildNotification('Storage', 30, 100, 'ops@example.com');
 * // => null  (below 80%)
 */
export function buildNotification(
  type: string,
  used: number,
  limit: number,
  email: string,
): QuotaNotification | null {
  if (limit <= 0) return null;

  const pctUsed = Math.round(((used / limit) * 100 + Number.EPSILON) * 100) / 100;
  const threshold = notificationTier(pctUsed);
  if (threshold === null) return null;

  const subject = buildSubject(type, pctUsed);
  const body = buildBody(type, used, limit, pctUsed);

  return { body, email, limit, pctUsed, subject, threshold, type, used };
}

/**
 * Format the email subject line for a quota notification.
 *
 * @param type - Resource type label.
 * @param pctUsed - Usage percentage.
 * @returns The formatted subject line.
 */
function buildSubject(type: string, pctUsed: number): string {
  if (pctUsed >= 100) return `🚫 ${type} at capacity`;
  if (pctUsed >= 90) return `⚠️ ${type} at ${pctUsed}% capacity`;
  return `ℹ️ ${type} at ${pctUsed}% capacity`;
}

/**
 * Format the email body text for a quota notification.
 *
 * @param type - Resource type label.
 * @param used - Current usage.
 * @param limit - Maximum allowed.
 * @param pctUsed - Usage percentage.
 * @returns The formatted body text.
 */
function buildBody(type: string, used: number, limit: number, pctUsed: number): string {
  return `${type} usage is at ${pctUsed}% (${used}/${limit}).`;
}
