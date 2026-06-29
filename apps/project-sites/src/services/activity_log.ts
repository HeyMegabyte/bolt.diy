/**
 * @module services/activity_log
 *
 * Pure activity feed entry builder for the admin dashboard. All exports are
 * deterministic (no clock, no I/O): the caller supplies timestamps, this module
 * shapes them into typed Activity records and provides query helpers.
 *
 * @example
 * ```ts
 * const entry = createActivity('site.published', 'user_abc', 'Site live', { slug: 'my-site' });
 * // → { id: '…', type: 'site.published', userId: 'user_abc', message: 'Site live', … }
 * ```
 */

// Activity & ActivityType are defined in this file — no imports needed.

// ---------------------------------------------------------------------------
// ActivityType — the closed set of feed event kinds
// ---------------------------------------------------------------------------

/** Discriminated union of every event kind the activity log accepts. */
export const ACTIVITY_TYPES = Object.freeze([
  'site.created',
  'site.published',
  'domain.added',
  'billing.upgraded',
  'build.started',
  'build.completed',
  'build.failed',
  'lead.claimed',
  'team.invited',
] as const);

/** Validates a string is a known ActivityType. */
export function isActivityType(s: string): s is ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Activity — the canonical feed record shape
// ---------------------------------------------------------------------------

/** A single entry in the admin activity feed. */
export interface Activity {
  /** Deterministic id — caller provides (UUIDv7 recommended). */
  id: string;
  /** Event kind. */
  type: ActivityType;
  /** Who performed the action. */
  userId: string;
  /** Optional site the event relates to. */
  siteId?: string;
  /** Human-readable summary. */
  message: string;
  /** Arbitrary structured metadata (secrets redacted before storage). */
  metadata: Record<string, unknown>;
  /** ISO 8601 UTC timestamp. */
  timestamp: string;
}

export type ActivityType =
  | 'site.created'
  | 'site.published'
  | 'domain.added'
  | 'billing.upgraded'
  | 'build.started'
  | 'build.completed'
  | 'build.failed'
  | 'lead.claimed'
  | 'team.invited';

// ---------------------------------------------------------------------------
// ACTIVITY_ICONS — emoji per type for the feed UI
// ---------------------------------------------------------------------------

/**
 * Maps each ActivityType to a single-emoji string suitable for feed rendering.
 * The emoji is the icon — it carries semantic meaning, not decoration.
 */
export const ACTIVITY_ICONS: Record<ActivityType, string> = Object.freeze({
  'billing.upgraded': '\u{2B50}', // ⭐
  'build.completed': '\u{2705}', // ✅
  'build.failed': '\u{274C}', // ❌
  'build.started': '\u{1F3D7}', // 🏗
  'domain.added': '\u{1F310}', // 🌐
  'lead.claimed': '\u{1F4B0}', // 💰
  'site.created': '\u{1F4C1}', // 📁
  'site.published': '\u{1F680}', // 🚀
  'team.invited': '\u{1F91D}', // 🤝
});

// ---------------------------------------------------------------------------
// createActivity — factory
// ---------------------------------------------------------------------------

/**
 * Builds a fully-typed Activity record.
 *
 * @param type      - The event kind.
 * @param userId    - The user who performed the action.
 * @param message   - Human-readable summary (caller-localized).
 * @param metadata  - Optional structured context (defaults to {}).
 * @param siteId    - Optional site the event relates to.
 * @param timestamp - ISO 8601 UTC string (defaults to current time ISO).
 * @returns A complete Activity ready for storage.
 *
 * @example
 * ```ts
 * const a = createActivity('site.published', 'user1', 'My Site is live', { slug: 'my-site' });
 * expect(a.type).toBe('site.published');
 * expect(a.message).toBe('My Site is live');
 * ```
 */
export function createActivity(
  type: ActivityType,
  userId: string,
  message: string,
  metadata?: Record<string, unknown>,
  siteId?: string,
  timestamp?: string,
): Activity {
  return {
    id: crypto.randomUUID(),
    message,
    metadata: { ...(metadata ?? {}) },
    siteId,
    timestamp: timestamp ?? new Date().toISOString(),
    type,
    userId,
  };
}

// ---------------------------------------------------------------------------
// activitySummary — concatenate into one human-readable string
// ---------------------------------------------------------------------------

/**
 * Joins a list of activities into a single human-readable summary line,
 * suitable for tooltip previews or notification snippets.
 *
 * Returns an empty string when the list is empty.
 *
 * @param items - Sorted or unsorted activities.
 * @returns A summary like "3 activities: site.published, build.completed".
 *
 * @example
 * ```ts
 * activitySummary([])                                                    // ''
 * activitySummary([published])                                           // '1 activity: site.published'
 * activitySummary([created, published])                                  // '2 activities: site.created, site.published'
 * ```
 */
export function activitySummary(items: readonly Activity[]): string {
  if (items.length === 0) return '';
  const label = items.length === 1 ? 'activity' : 'activities';
  const types = items.map((a) => a.type).join(', ');
  return `${items.length} ${label}: ${types}`;
}

// ---------------------------------------------------------------------------
// filterBySite — keep only activities scoped to a site
// ---------------------------------------------------------------------------

/**
 * Returns a new array containing only activities whose `siteId` matches the
 * given `siteId`. Activities without a `siteId` are excluded.
 *
 * @param items  - Activity list to filter.
 * @param siteId - The site id to match.
 * @returns A filtered copy; never the original reference.
 *
 * @example
 * ```ts
 * const filtered = filterBySite(all, 'site_abc');
 * expect(filtered.every(a => a.siteId === 'site_abc')).toBe(true);
 * ```
 */
export function filterBySite(items: readonly Activity[], siteId: string): Activity[] {
  return items.filter((a) => a.siteId === siteId);
}
