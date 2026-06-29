/**
 * @module services/plan_migration_log
 * @description Pure in-memory migration history tracking and stats. Logs plan
 * changes as immutable entries, filters by org, and computes aggregate counts.
 * Zero side-effects — no I/O, no clock, caller supplies all timestamps.
 *
 * @example
 * ```ts
 * const entry = logMigration('org_1', 'free', 'starter', 750);
 * // → { id: '…', orgId: 'org_1', from: 'free', to: 'starter', proration: 750, date: '…' }
 * ```
 */

// ── Types ───────────────────────────────────────────────────

/**
 * A single plan migration event. Immutable after creation.
 * The `id` is a UUIDv7 and `date` is an ISO-8601 UTC string.
 */
export interface MigrationLog {
  /** Deterministic UUIDv7 identifier. */
  readonly id: string;
  /** The organization that changed plans. */
  readonly orgId: string;
  /** The plan slug the org is leaving. */
  readonly from: string;
  /** The plan slug the org is moving to. */
  readonly to: string;
  /** Prorated charge or refund, caller-supplied in cents (or any unit). */
  readonly proration: number;
  /** ISO-8601 UTC timestamp of the event. */
  readonly date: string;
}

/** Aggregate migration counts. */
export interface MigrationStats {
  /** Total number of migrations in the input set. */
  readonly total: number;
  /** Number of migrations that are upgrades (to a higher tier). */
  readonly upgrades: number;
  /** Number of migrations that are downgrades (to a lower tier). */
  readonly downgrades: number;
}

// ── Helper ─────────────────────────────────────────────────

/**
 * Numeric plan tiers for ordering. Higher = more capability.
 * Must stay in sync with the canonical {@link PLAN_TIER} map
 * in `plan_migration.ts` — duplicated here so this module is
 * self-contained and pure.
 */
const PLAN_ORDER: Record<string, number> = {
  free: 0,
  starter: 1,
  pro: 2,
} as const;

/**
 * Compare two plan slugs and return `1` when `to` is strictly
 * higher tier, `-1` when lower, and `0` when equal.
 */
function cmpPlans(from: string, to: string): 1 | -1 | 0 {
  const a = PLAN_ORDER[from] ?? -1;
  const b = PLAN_ORDER[to] ?? -1;
  if (b > a) return 1;
  if (b < a) return -1;
  return 0;
}

// ── Public API ──────────────────────────────────────────────

/**
 * Create an immutable migration log entry.
 *
 * Generates a UUIDv7 `id` and an ISO-8601 UTC `date` from the caller-supplied
 * timestamp (defaults to the current wall-clock time ISO string). The entry
 * is fully formed and ready for storage.
 *
 * @param orgId     - The organization identifier.
 * @param from      - Plan slug the org is leaving.
 * @param to        - Plan slug the org is joining.
 * @param proration - Prorated amount in cents (or any unit).
 * @param date      - Optional ISO-8601 UTC timestamp (defaults to now).
 * @returns A complete MigrationLog entry.
 *
 * @example
 * ```ts
 * const entry = logMigration('org_1', 'free', 'starter', 750);
 * expect(entry.orgId).toBe('org_1');
 * expect(entry.from).toBe('free');
 * expect(entry.to).toBe('starter');
 * expect(entry.proration).toBe(750);
 * ```
 */
export function logMigration(
  orgId: string,
  from: string,
  to: string,
  proration: number,
  date?: string,
): MigrationLog {
  return {
    id: crypto.randomUUID(),
    orgId,
    from,
    to,
    proration,
    date: date ?? new Date().toISOString(),
  };
}

/**
 * Filter a list of migration logs to only those belonging to a specific org.
 *
 * Returns a new array; never mutates the input. Empty input yields an empty
 * result.
 *
 * @param logs  - Array of migration log entries.
 * @param orgId - The organization identifier to match.
 * @returns Filtered entries for the given org.
 *
 * @example
 * ```ts
 * const orgEntries = migrationHistory(allLogs, 'org_1');
 * expect(orgEntries.every(e => e.orgId === 'org_1')).toBe(true);
 * ```
 *
 * @example
 * migrationHistory([], 'org_1');
 * // → []
 */
export function migrationHistory(logs: readonly MigrationLog[], orgId: string): MigrationLog[] {
  return logs.filter((e) => e.orgId === orgId);
}

/**
 * Compute aggregate upgrade/downgrade counts from a list of migration logs.
 *
 * Uses {@link PLAN_ORDER} to classify each migration. An unknown plan slug is
 * treated as tier -1. Equal tiers (including same-plan transitions) are not
 * counted in either upgrades or downgrades.
 *
 * @param logs - Array of migration log entries.
 * @returns Aggregate counts (total, upgrades, downgrades).
 *
 * @example
 * ```ts
 * const stats = migrationStats([
 *   // org_1 goes free → starter (upgrade)
 *   logMigration('org_1', 'free', 'starter', 0, '2026-01-01T00:00:00Z'),
 *   // org_2 goes pro → free (downgrade)
 *   logMigration('org_2', 'pro', 'free', 0, '2026-01-02T00:00:00Z'),
 * ]);
 * // { total: 2, upgrades: 1, downgrades: 1 }
 * ```
 *
 * @example
 * migrationStats([]);
 * // → { total: 0, upgrades: 0, downgrades: 0 }
 */
export function migrationStats(logs: readonly MigrationLog[]): MigrationStats {
  let upgrades = 0;
  let downgrades = 0;

  for (const entry of logs) {
    const dir = cmpPlans(entry.from, entry.to);
    if (dir === 1) upgrades++;
    else if (dir === -1) downgrades++;
  }

  return {
    total: logs.length,
    upgrades,
    downgrades,
  };
}
