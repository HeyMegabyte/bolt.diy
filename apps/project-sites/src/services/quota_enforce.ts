/**
 * @module services/quota_enforce
 *
 * @description
 * Runtime quota enforcement toolkit — pure helpers that route handlers call AFTER
 * they've determined the plan limit (via {@link project_quota.getProjectQuota} or
 * similar) and want to: (a) check whether the current count is within bounds,
 * (b) format a human-readable "you've hit the limit" message, and (c) produce an
 * RFC7807-style error envelope the error handler can serialize.
 *
 * Complements {@link quota_notification} (warns BEFORE the limit) and
 * {@link project_quota} (defines the caps). This module handles the rejection
 * side: telling the user they're blocked and what to do about it.
 *
 * Pure + total — no I/O, no clock, no Worker deps.
 *
 * @see services/project_quota.ts — per-project cap lookups
 * @see services/quota_notification.ts — soft warnings before the hard block
 */

/** The resource types that can be quota-enforced. */
export type QuotaType =
  | 'sites'
  | 'pages'
  | 'images'
  | 'storage_mb'
  | 'custom_domains'
  | 'team_members'
  | 'builds_per_day'
  | 'emails_per_day'
  | 'api_tokens';

/** Known plan tiers for quota-enforcement messaging. */
export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise';

/** Human-readable label for each quota type, used in messages. */
const QUOTA_LABELS: Record<QuotaType, string> = {
  sites: 'sites',
  pages: 'pages',
  images: 'images',
  storage_mb: 'storage',
  custom_domains: 'custom domains',
  team_members: 'team members',
  builds_per_day: 'daily builds',
  emails_per_day: 'daily emails',
  api_tokens: 'API tokens',
} as const;

/** The result of a quota check. */
export interface CheckQuotaResult {
  /** Whether the quota is exceeded (used >= limit). */
  readonly isExceeded: boolean;
  /** Current usage in raw units. */
  readonly used: number;
  /** Maximum allowed in raw units. */
  readonly limit: number;
  /** Units remaining before the cap (limit - used; negative when over). */
  readonly remaining: number;
  /** Usage as a percentage of the limit (0–100, clamped). */
  readonly utilizationPercent: number;
}

/** RFC7807-style error envelope for a hard quota block. */
export interface QuotaBlockEnvelope {
  readonly error: {
    /** Stable machine-readable error code. */
    readonly code: string;
    /** Human-readable explanation. */
    readonly message: string;
    /** The resource type that was exceeded. */
    readonly type: QuotaType;
    /** Current usage in raw units. */
    readonly used: number;
    /** Maximum allowed in raw units. */
    readonly limit: number;
    /** The plan tier the user is on. */
    readonly plan: PlanTier;
    /** Suggested upgrade action. */
    readonly suggestion: string;
  };
}

/**
 * Check whether the current usage exceeds a numeric quota limit.
 *
 * @param used - Current usage in raw units. Negative values are treated as 0.
 * @param limit - Maximum allowed in raw units. Zero or negative means "no limit
 *   enforceable" — returns `isExceeded: false`.
 * @returns A {@link CheckQuotaResult} with all derived fields populated.
 *
 * @example
 * checkQuota(10, 10)   // → { isExceeded: true,  used: 10, limit: 10, remaining: 0,  utilizationPercent: 100 }
 * checkQuota(9, 10)    // → { isExceeded: false, used: 9,  limit: 10, remaining: 1,  utilizationPercent: 90 }
 * checkQuota(0, 0)     // → { isExceeded: false, used: 0,  limit: 0,  remaining: 0,  utilizationPercent: 0 }
 * checkQuota(-5, 10)   // → { isExceeded: false, used: 0,  limit: 10, remaining: 10, utilizationPercent: 0 }
 */
export function checkQuota(used: number, limit: number): CheckQuotaResult {
  const safeUsed = typeof used === 'number' && !Number.isNaN(used) ? Math.max(0, used) : 0;
  const safeLimit = typeof limit === 'number' && !Number.isNaN(limit) ? Math.max(0, limit) : 0;

  if (safeLimit <= 0) {
    return { isExceeded: false, used: safeUsed, limit: safeLimit, remaining: 0, utilizationPercent: 0 };
  }

  const remaining = Math.max(0, safeLimit - safeUsed);
  const pct = Math.min(100, Math.round(((safeUsed / safeLimit) * 100 + Number.EPSILON) * 100) / 100);

  return {
    isExceeded: safeUsed >= safeLimit,
    used: safeUsed,
    limit: safeLimit,
    remaining,
    utilizationPercent: pct,
  };
}

/**
 * Build a human-readable "quota exceeded" message.
 *
 * @param type - The resource type that was exceeded.
 * @param used - Current usage in raw units.
 * @param limit - Maximum allowed in raw units.
 * @returns A plain-English sentence explaining the situation. Never throws.
 *
 * @example
 * exceededMessage('sites', 5, 3)
 * // → "You've used 5 of 3 sites. Upgrade your plan to create more."
 *
 * exceededMessage('storage_mb', 50, 0)
 * // → "Storage is unlimited on your plan."
 *
 * exceededMessage('images', 10, 10)
 * // → "You've used 10 of 10 images. Upgrade your plan to add more."
 */
export function exceededMessage(type: QuotaType, used: number, limit: number): string {
  const label = QUOTA_LABELS[type] ?? type;
  const safeUsed = typeof used === 'number' && !Number.isNaN(used) ? Math.max(0, used) : 0;
  const safeLimit = typeof limit === 'number' && !Number.isNaN(limit) ? Math.max(0, limit) : 0;

  if (safeLimit <= 0) {
    return `${capitalize(label)} is unlimited on your plan.`;
  }

  if (safeUsed >= safeLimit) {
    return `You've used ${safeUsed} of ${safeLimit} ${label}. Upgrade your plan to add more.`;
  }

  return `You've used ${safeUsed} of ${safeLimit} ${label}.`;
}

/**
 * Produce an RFC7807-style error envelope for a hard quota block.
 *
 * The returned object is designed to be serialized into a JSON error response
 * (typically 403 Forbidden or 429 Too Many Requests). The `suggestion` field
 * guides the user toward the next action.
 *
 * @param type - The resource type that was exceeded.
 * @param plan - The plan tier the user is on.
 * @returns A {@link QuotaBlockEnvelope} ready for JSON serialization. Never throws.
 *
 * @example
 * quotaBlock('sites', 'free')
 * // → { error: { code: 'QUOTA_EXCEEDED', message: "You've reached your sites limit.", ... } }
 *
 * quotaBlock('custom_domains', 'free')
 * // → { error: { code: 'QUOTA_EXCEEDED', message: "You've reached your custom domains limit. Upgrade to paid.", ... } }
 */
export function quotaBlock(type: QuotaType, plan: PlanTier): QuotaBlockEnvelope {
  const label = QUOTA_LABELS[type] ?? type;
  const suggestion = plan === 'enterprise'
    ? `Contact support to increase your ${label} limit.`
    : `Upgrade your plan to unlock more ${label}.`;

  return {
    error: {
      code: 'QUOTA_EXCEEDED',
      message: `You've reached your ${label} limit.`,
      type,
      used: 0,
      limit: 0,
      plan,
      suggestion,
    },
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
