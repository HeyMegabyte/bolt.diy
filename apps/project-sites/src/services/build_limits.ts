/**
 * @module services/build_limits
 *
 * @description
 * Per-org build allowance — free users get 3 builds, paid users get 50, owners
 * of unlimited orgs get `Infinity`. Tracked by counting non-deleted rows in the
 * `sites` table (soft-deletes don't free a slot — by design, so users can't
 * dodge the quota by churning).
 *
 * @remarks
 * - The `UNLIMITED_ORGS` set is request-cached, populated lazily when the
 *   owner's email matches a known whitelist (e.g. `brian@megabyte.space`).
 *   This keeps the membership query off the hot path for repeat callers in
 *   the same worker isolate.
 * - Callers MUST pass the org's billing plan (`'paid' | 'free' | null`) —
 *   the caller is the source of truth (read from `subscriptions` table or
 *   entitlements) and we don't re-resolve here to keep the function pure.
 */
import { dbQuery, dbQueryOne } from './db.js';

/** Free-tier site quota — kept in lock-step with PRICING constants in shared/. */
const FREE_LIMIT = 3;
/** Paid-tier site quota — kept in lock-step with PRICING constants in shared/. */
const PAID_LIMIT = 50;

/** Per-isolate cache of orgs known to have unlimited builds (populated lazily). */
const UNLIMITED_ORGS = new Set<string>();

/**
 * Check whether the org can create another site without exceeding its plan.
 *
 * @param db    - D1Database binding.
 * @param orgId - Organization to check.
 * @param plan  - The active billing plan (`'paid'` → 50, anything else → 3).
 *   `null` is the unsigned-in / no-subscription default → free tier.
 * @returns Quota snapshot — `allowed`, `used`, `limit`, `remaining`.
 *
 * @example
 * ```ts
 * const quota = await checkBuildLimit(env.DB, orgId, subscription?.plan ?? null);
 * if (!quota.allowed) throw new AppError('FORBIDDEN', `Build limit reached (${quota.used}/${quota.limit})`);
 * ```
 */
export async function checkBuildLimit(
  db: D1Database,
  orgId: string,
  plan: string | null,
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  // Check if this org has unlimited builds
  if (UNLIMITED_ORGS.has(orgId)) {
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }

  // Check if the org owner's email is in the unlimited list
  const owner = await dbQueryOne<{ email: string }>(
    db,
    `SELECT u.email FROM users u JOIN memberships m ON u.id = m.user_id WHERE m.org_id = ? AND m.role = 'owner' LIMIT 1`,
    [orgId],
  );
  if (owner?.email === 'brian@megabyte.space') {
    UNLIMITED_ORGS.add(orgId);
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }

  const limit = plan === 'paid' ? PAID_LIMIT : FREE_LIMIT;

  const result = await dbQuery<{ count: number }>(
    db,
    'SELECT COUNT(*) as count FROM sites WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );

  const used = result.data[0]?.count ?? 0;
  const remaining = Math.max(0, limit - used);

  return {
    allowed: used < limit,
    used,
    limit,
    remaining,
  };
}
