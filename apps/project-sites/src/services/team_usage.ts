/**
 * @module services/team_usage
 *
 * @description
 * Pure team-usage tracking and aggregation helpers. All exports are
 * deterministic (no clock, no I/O): the caller supplies timestamps and
 * event arrays, this module shapes them into typed records and provides
 * aggregation queries.
 *
 * @example
 * ```ts
 * const e1 = trackTeamUsage('org_abc', 'user_1', 'site.created');
 * const e2 = trackTeamUsage('org_abc', 'user_2', 'site.published');
 * const stats = teamUsageStats([e1, e2], 'org_abc');
 * // → { total: 2, byAction: { 'site.created': 1, 'site.published': 1 }, uniqueUsers: 2, dateRange: {...} }
 * ```
 */

// ---------------------------------------------------------------------------
// TeamUsageEvent — the canonical record shape
// ---------------------------------------------------------------------------

/** A single team usage event entry. */
export interface TeamUsageEvent {
  /** Deterministic id — caller provides (UUIDv7 recommended). */
  readonly id: string;
  /** The organization scope. */
  readonly orgId: string;
  /** The user who performed the action. */
  readonly userId: string;
  /** The action kind (e.g. 'site.published', 'domain.added'). */
  readonly action: string;
  /** ISO 8601 UTC timestamp when the action occurred. */
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// TeamUsageStats — aggregation result shape
// ---------------------------------------------------------------------------

/** Aggregate usage statistics for an organization. */
export interface TeamUsageStats {
  /** Total number of events matching the org. */
  total: number;
  /** Event count broken down by action kind. */
  byAction: Record<string, number>;
  /** Number of distinct users who performed events. */
  uniqueUsers: number;
  /** Timestamp range of matching events, or null if none. */
  dateRange: { from: string; to: string } | null;
}

// ---------------------------------------------------------------------------
// TopUserEntry — single entry in the top-users leaderboard
// ---------------------------------------------------------------------------

/** A single entry in the top-users ranking. */
export interface TopUserEntry {
  /** The user who performed the events. */
  userId: string;
  /** Number of events attributed to this user. */
  count: number;
}

// ---------------------------------------------------------------------------
// trackTeamUsage — factory
// ---------------------------------------------------------------------------

/**
 * Builds a fully-typed TeamUsageEvent record.
 *
 * @param orgId    - The organization scope.
 * @param userId   - The user who performed the action.
 * @param action   - The action kind (caller-chosen string, e.g. `'site.published'`).
 * @param timestamp - ISO 8601 UTC string (defaults to current time ISO).
 * @returns A complete TeamUsageEvent ready for storage or display.
 *
 * @example
 * ```ts
 * const e = trackTeamUsage('org_abc', 'user_1', 'site.published');
 * expect(e.orgId).toBe('org_abc');
 * expect(e.userId).toBe('user_1');
 * expect(e.action).toBe('site.published');
 * expect(e.id).toEqual(expect.any(String));
 * ```
 */
export function trackTeamUsage(
  orgId: string,
  userId: string,
  action: string,
  timestamp?: string,
): TeamUsageEvent {
  return {
    action,
    id: crypto.randomUUID(),
    orgId,
    timestamp: timestamp ?? new Date().toISOString(),
    userId,
  };
}

// ---------------------------------------------------------------------------
// teamUsageStats — aggregate events for an org
// ---------------------------------------------------------------------------

/**
 * Aggregates a list of usage events into summary statistics for the given
 * organization.
 *
 * Returns a TeamUsageStats with total count, per-action breakdown, unique
 * user count, and the min/max timestamp range of matching events.
 *
 * @param items  - Event list to aggregate.
 * @param orgId  - The organization id to match.
 * @returns Aggregated stats; never the original reference.
 *
 * @example
 * ```ts
 * const e1 = trackTeamUsage('org_abc', 'user_1', 'site.created', '2026-01-01T00:00:00.000Z');
 * const e2 = trackTeamUsage('org_abc', 'user_2', 'site.published', '2026-06-15T12:00:00.000Z');
 * const stats = teamUsageStats([e1, e2], 'org_abc');
 * expect(stats.total).toBe(2);
 * expect(stats.byAction['site.created']).toBe(1);
 * expect(stats.uniqueUsers).toBe(2);
 * expect(stats.dateRange?.from).toBe('2026-01-01T00:00:00.000Z');
 * ```
 */
export function teamUsageStats(items: readonly TeamUsageEvent[], orgId: string): TeamUsageStats {
  const matching = items.filter((e) => e.orgId === orgId);

  if (matching.length === 0) {
    return { byAction: {}, dateRange: null, total: 0, uniqueUsers: 0 };
  }

  const byAction: Record<string, number> = {};
  const userSet = new Set<string>();
  let minTs = matching[0].timestamp;
  let maxTs = matching[0].timestamp;

  for (const event of matching) {
    byAction[event.action] = (byAction[event.action] ?? 0) + 1;
    userSet.add(event.userId);
    if (event.timestamp < minTs) minTs = event.timestamp;
    if (event.timestamp > maxTs) maxTs = event.timestamp;
  }

  return {
    byAction,
    dateRange: { from: minTs, to: maxTs },
    total: matching.length,
    uniqueUsers: userSet.size,
  };
}

// ---------------------------------------------------------------------------
// topUsers — rank users by event count
// ---------------------------------------------------------------------------

/**
 * Returns the top N active users for an organization, ranked by event count
 * descending.
 *
 * @param items  - Event list to analyse.
 * @param orgId  - The organization id to match.
 * @param topN   - Number of users to return (defaults to 10, capped at items length).
 * @returns Ranked array of TopUserEntry objects.
 *
 * @example
 * ```ts
 * const events = [
 *   trackTeamUsage('org_abc', 'user_1', 'site.created'),
 *   trackTeamUsage('org_abc', 'user_1', 'site.published'),
 *   trackTeamUsage('org_abc', 'user_2', 'site.created'),
 * ];
 * const top = topUsers(events, 'org_abc');
 * expect(top[0]).toEqual({ userId: 'user_1', count: 2 });
 * expect(top[1]).toEqual({ userId: 'user_2', count: 1 });
 * ```
 */
export function topUsers(
  items: readonly TeamUsageEvent[],
  orgId: string,
  topN: number = 10,
): TopUserEntry[] {
  const matching = items.filter((e) => e.orgId === orgId);

  const counts = new Map<string, number>();
  for (const event of matching) {
    counts.set(event.userId, (counts.get(event.userId) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([userId, count]) => ({ count, userId }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, topN));
}
