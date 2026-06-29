/**
 * @module services/member_activity
 *
 * @description
 * Pure activity recording for member-facing dashboards. Provides a factory
 * for creating typed member activity records and a feed query helper that
 * filters and sorts by organization.
 *
 * All exports are deterministic aside from timestamp generation when the
 * caller omits the optional timestamp parameter.
 *
 * @example
 * ```ts
 * const activity = recordActivity('org_abc', 'user_1', 'site.published');
 * // → { orgId: 'org_abc', userId: 'user_1', action: 'site.published', timestamp: '2026-06-29T12:00:00.000Z' }
 *
 * const feed = activityFeed([activity, ...], 'org_abc');
 * // → only activities scoped to org_abc, newest first
 * ```
 */

// ---------------------------------------------------------------------------
// MemberActivity — the canonical feed record shape
// ---------------------------------------------------------------------------

/** A single entry in a member activity feed. */
export interface MemberActivity {
  /** The organization the action belongs to. */
  readonly orgId: string;
  /** The user who performed the action. */
  readonly userId: string;
  /** The action kind (e.g. 'site.published', 'domain.added'). */
  readonly action: string;
  /** ISO 8601 UTC timestamp when the action occurred. */
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// recordActivity — factory
// ---------------------------------------------------------------------------

/**
 * Builds a fully-typed MemberActivity record.
 *
 * @param orgId    - The organization scope.
 * @param userId   - The user who performed the action.
 * @param action   - The action kind (caller-chosen string, e.g. `'site.published'`).
 * @param timestamp - ISO 8601 UTC string (defaults to current time ISO).
 * @returns A complete MemberActivity ready for storage or display.
 *
 * @example
 * ```ts
 * const a = recordActivity('org_abc', 'user_1', 'site.published');
 * expect(a.orgId).toBe('org_abc');
 * expect(a.userId).toBe('user_1');
 * expect(a.action).toBe('site.published');
 * ```
 */
export function recordActivity(
  orgId: string,
  userId: string,
  action: string,
  timestamp?: string,
): MemberActivity {
  return {
    action,
    orgId,
    timestamp: timestamp ?? new Date().toISOString(),
    userId,
  };
}

// ---------------------------------------------------------------------------
// activityFeed — filter by org + sort by timestamp (newest first)
// ---------------------------------------------------------------------------

/**
 * Returns a new array containing only activities whose `orgId` matches the
 * given `orgId`, sorted newest-first by timestamp.
 *
 * Returns an empty array when the input list is empty or has no matching
 * activities.
 *
 * @param items  - Activity list to filter.
 * @param orgId  - The organization id to match.
 * @returns A filtered and sorted copy; never the original reference.
 *
 * @example
 * ```ts
 * const feed = activityFeed(all, 'org_abc');
 * expect(feed.every(a => a.orgId === 'org_abc')).toBe(true);
 * // newest entry first
 * if (feed.length >= 2) {
 *   expect(feed[0].timestamp >= feed[1].timestamp).toBe(true);
 * }
 * ```
 */
export function activityFeed(items: readonly MemberActivity[], orgId: string): MemberActivity[] {
  return items
    .filter((a) => a.orgId === orgId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}
