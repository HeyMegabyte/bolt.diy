/**
 * @module services/project_quota
 *
 * @description
 * Per-project resource quotas by plan tier — a pure SSOT for budget-units (pages,
 * images, forms, blog posts, team members). Every route that provisions one of
 * these resources calls {@link isQuotaExceeded} before creating a new record.
 *
 * Plans are ordered strings (not an enum) so new tiers can be added without
 * changing this file: `"free"`, `"starter"`, `"pro"`. Unknown plans resolve to
 * zero (quota is always exceeded).
 *
 * Pure + total — no I/O, no clock, no Worker deps.
 *
 * @see worker/routes/api.ts (quota checks on site publish)
 */

/** A resource type subject to per-project budgeting. */
export type ProjectQuota = 'pages' | 'images' | 'forms' | 'blog_posts' | 'team_members';

/** A single quota row — the cap per resource per plan and the display unit. */
export interface QuotaLimit {
  readonly type: ProjectQuota;
  readonly free: number;
  readonly starter: number;
  readonly pro: number;
  readonly unit: string;
}

/**
 * The authoritative quota matrix. Plan-less entries are not allowed — add a new
 * plan here, then it works everywhere.
 *
 * - **pages**: free 3 / starter 10 / pro 50
 * - **images**: free 10 / starter 50 / pro 200
 * - **forms**: free 1 / starter 3 / pro 10
 * - **blog_posts**: free 0 / starter 5 / pro 25
 * - **team_members**: free 1 / starter 3 / pro 10
 */
export const QUOTA_MATRIX: readonly QuotaLimit[] = [
  { free: 3, pro: 50, starter: 10, type: 'pages', unit: 'pages' },
  { free: 10, pro: 200, starter: 50, type: 'images', unit: 'images' },
  { free: 1, pro: 10, starter: 3, type: 'forms', unit: 'forms' },
  { free: 0, pro: 25, starter: 5, type: 'blog_posts', unit: 'posts' },
  { free: 1, pro: 10, starter: 3, type: 'team_members', unit: 'members' },
] as const;

const MATRIX_BY_TYPE: ReadonlyMap<ProjectQuota, QuotaLimit> = new Map(
  QUOTA_MATRIX.map((q) => [q.type, q]),
);

const PLAN_KEYS = ['free', 'starter', 'pro'] as const;
type PlanKey = (typeof PLAN_KEYS)[number];

function isKnownPlan(plan: string): plan is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(plan);
}

/**
 * Look up the numeric cap for a resource under a given plan.
 *
 * @param type - The resource type to check.
 * @param plan - The plan label (`"free"` | `"starter"` | `"pro"`). Unknown
 *   plans return `0` (quota is always exceeded).
 * @returns The maximum allowed count for this resource+plan, or `0` for
 *   unknown plans which disables the resource entirely.
 *
 * @example getProjectQuota('pages', 'starter') // → 10
 * @example getProjectQuota('blog_posts', 'free') // → 0
 * @example getProjectQuota('images', 'unknown') // → 0
 */
export function getProjectQuota(type: ProjectQuota, plan: string): number {
  const row = MATRIX_BY_TYPE.get(type);
  if (!row) return 0;
  if (!isKnownPlan(plan)) return 0;
  return row[plan];
}

/**
 * Whether the resource has reached (or exceeded) its plan cap.
 *
 * @param type - The resource type to check.
 * @param plan - The plan label. Unknown plans always exceed.
 * @param used - The current count already consumed.
 * @returns `true` when `used >= getProjectQuota(type, plan)`.
 *
 * @example isQuotaExceeded('pages', 'free', 3)   // → true
 * @example isQuotaExceeded('pages', 'free', 2)   // → false
 * @example isQuotaExceeded('images', 'pro', 200) // → true
 */
export function isQuotaExceeded(type: ProjectQuota, plan: string, used: number): boolean {
  const limit = getProjectQuota(type, plan);
  return used >= limit;
}
