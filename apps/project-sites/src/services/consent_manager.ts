/**
 * @module services/consent_manager
 *
 * @description
 * GDPR/ePrivacy consent record manager. Tracks which categories a user has
 * granted or denied, and exposes predicate helpers for gating analytics,
 * marketing, and preference features. Pure + total — no I/O, no clock.
 *
 * Every consent record carries a version string so the application can detect
 * when the schema or category set has changed and re-prompt stale records.
 *
 * @see https://gdpr.eu/cookies/
 */

/**
 * The four consent categories a user may grant or deny.
 *
 *   necessary   — core function (session, CSRF, load-balancing). Always true.
 *   analytics   — usage tracking (page views, feature usage, heatmaps).
 *   marketing   — advertising, personalization, cross-site tracking.
 *   preferences — persistent user settings (theme, layout, locale).
 */
export type ConsentCategory = 'necessary' | 'analytics' | 'marketing' | 'preferences';

/**
 * A persisted consent decision.
 *
 * @property userId - The user or device identifier this record belongs to.
 * @property categories - Per-category boolean grant. `true` = granted.
 * @property consentedAt - Unix-millisecond timestamp of when consent was given.
 * @property version - The {@link CONSENT_VERSION} at the time of recording.
 */
export interface ConsentRecord {
  readonly userId: string;
  readonly categories: Record<ConsentCategory, boolean>;
  readonly consentedAt: number;
  readonly version: string;
}

/** Current consent schema version. Bump when categories change. */
export const CONSENT_VERSION = '1.0';

/**
 * Factory default for every category. `necessary` is always granted; the rest
 * default to `false` (denied until the user affirmatively opts in).
 */
export const DEFAULT_CONSENT: Record<ConsentCategory, boolean> = Object.freeze({
  necessary: true,
  analytics: false,
  marketing: false,
  preferences: false,
});

const ALL_CATEGORIES: readonly ConsentCategory[] = Object.keys(
  DEFAULT_CONSENT,
) as ConsentCategory[];

/**
 * Build a {@link ConsentRecord} for a user who has just granted specific
 * categories. Categories not listed default to {@link DEFAULT_CONSENT}.
 *
 * @param userId - Who granted consent.
 * @param granted - The categories the user actively opted into.
 * @param version - Schema version to stamp (defaults to {@link CONSENT_VERSION}).
 * @param nowMs - Timestamp override for testing (defaults to `Date.now()`).
 * @returns A frozen consent record.
 *
 * @example
 * createConsent('user_abc', ['analytics', 'preferences'])
 * // → { userId: 'user_abc', categories: { necessary: true, analytics: true,
 * //     marketing: false, preferences: true }, consentedAt: 1719532800000,
 * //     version: '1.0' }
 */
export function createConsent(
  userId: string,
  granted: ConsentCategory[],
  version?: string,
  nowMs?: number,
): ConsentRecord {
  const categories = { ...DEFAULT_CONSENT } as Record<ConsentCategory, boolean>;
  for (const cat of granted) {
    categories[cat] = true;
  }

  return Object.freeze({
    userId,
    categories: Object.freeze(categories),
    consentedAt: nowMs ?? Date.now(),
    version: version ?? CONSENT_VERSION,
  });
}

/**
 * Check whether a consent record grants a specific category.
 *
 * @param record - The user's stored consent.
 * @param category - The category to check.
 * @returns `true` when the category is granted (or is `necessary`, which is
 *   always treated as granted regardless of the record).
 *
 * @example
 * hasConsent(record, 'analytics') // → true | false
 */
export function hasConsent(record: ConsentRecord, category: ConsentCategory): boolean {
  if (category === 'necessary') return true;
  return record.categories[category] === true;
}

/**
 * Check whether a consent record grants every category.
 *
 * @param record - The user's stored consent.
 * @returns `true` when every category is `true` (including `necessary`).
 *
 * @example
 * allConsentGranted(record) // → true | false
 */
export function allConsentGranted(record: ConsentRecord): boolean {
  return ALL_CATEGORIES.every((cat) => record.categories[cat] === true);
}
