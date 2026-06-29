/**
 * @module services/plan_entitlement
 * @description A7 (#121) — plan entitlement matrix. Pure zero-I/O feature limit
 * resolution for all plan-gated capabilities (sites, builds, AI credits,
 * analytics, media, team seats, email sends, and premium features). Replaces
 * hardcoded plan branches scattered across services with a single typed matrix.
 * Never throws — unknown features/plans return safe defaults (0, 'free').
 *
 * @packageDocumentation
 */

/** The three billing plan tiers. */
export type PlanTier = 'free' | 'starter' | 'pro';

/** Every plan-gated feature key in the system. */
export type FeatureKey =
  | 'sites'
  | 'builds_per_month'
  | 'ai_credits'
  | 'custom_domain'
  | 'analytics_history_days'
  | 'media_storage_mb'
  | 'team_seats'
  | 'email_sends_per_month'
  | 'remove_branding'
  | 'priority_build';

/** Per-feature limit definition across all three plan tiers. */
export interface FeatureLimit {
  /** Immutable feature key — matches the union literal. */
  readonly key: FeatureKey;
  /** Human-readable label (e.g. "Sites", "AI Credits"). */
  readonly label: string;
  /** Limit on the Free plan (0 = feature unavailable). */
  readonly free: number;
  /** Limit on the Starter plan (0 = unavailable; -1 = unlimited). */
  readonly starter: number;
  /** Limit on the Pro plan (0 = unavailable; -1 = unlimited). */
  readonly pro: number;
  /** Unit suffix (e.g. "sites", "credits", "days", "MB", "seats", "sends"). */
  readonly unit: string;
  /** Short upgrade pitch shown when the limit is reached. */
  readonly upgradeDescription: string;
}

/**
 * Canonical feature limit matrix. Immutable — treat as single source of truth
 * for all plan-gated limits.
 *
 * - free:     1 site, 5 builds/mo, 10 AI credits/mo, 0 custom domains,
 *             7-day analytics, 10 MB media, 1 seat, 100 email sends/mo,
 *             no remove-branding, no priority builds.
 * - starter:  3 sites, 50 builds/mo, 500 AI credits/mo, 1 custom domain,
 *             90-day analytics, 500 MB media, 2 seats, 1000 email sends/mo,
 *             no remove-branding, no priority builds.
 * - pro:      unlimited sites (-1), 500 builds/mo, 10000 AI credits/mo,
 *             unlimited custom domains (-1), 730-day analytics,
 *             5000 MB media, 10 seats, 50000 email sends/mo,
 *             remove-branding available (1), priority builds (1).
 */
export const FEATURE_MATRIX: readonly FeatureLimit[] = Object.freeze([
  {
    free: 1,
    key: 'sites',
    label: 'Sites',
    pro: -1,
    starter: 3,
    unit: 'sites',
    upgradeDescription: 'Upgrade to Starter for 3 sites, or Pro for unlimited sites.',
  },
  {
    free: 5,
    key: 'builds_per_month',
    label: 'Monthly Builds',
    pro: 500,
    starter: 50,
    unit: 'builds',
    upgradeDescription: 'Upgrade to Starter for 50 builds per month, or Pro for 500.',
  },
  {
    free: 10,
    key: 'ai_credits',
    label: 'AI Credits',
    pro: 10000,
    starter: 500,
    unit: 'credits',
    upgradeDescription: 'Upgrade to Starter for 500 AI credits per month, or Pro for 10,000.',
  },
  {
    free: 0,
    key: 'custom_domain',
    label: 'Custom Domains',
    pro: -1,
    starter: 1,
    unit: 'domains',
    upgradeDescription: 'Upgrade to Starter for 1 custom domain, or Pro for unlimited domains.',
  },
  {
    free: 7,
    key: 'analytics_history_days',
    label: 'Analytics History',
    pro: 730,
    starter: 90,
    unit: 'days',
    upgradeDescription: 'Upgrade to Starter for 90 days of analytics history, or Pro for 730 days.',
  },
  {
    free: 10,
    key: 'media_storage_mb',
    label: 'Media Storage',
    pro: 5000,
    starter: 500,
    unit: 'MB',
    upgradeDescription: 'Upgrade to Starter for 500 MB of media storage, or Pro for 5 GB.',
  },
  {
    free: 1,
    key: 'team_seats',
    label: 'Team Seats',
    pro: 10,
    starter: 2,
    unit: 'seats',
    upgradeDescription: 'Upgrade to Starter for 2 team seats, or Pro for 10 seats.',
  },
  {
    free: 100,
    key: 'email_sends_per_month',
    label: 'Monthly Email Sends',
    pro: 50000,
    starter: 1000,
    unit: 'sends',
    upgradeDescription: 'Upgrade to Starter for 1,000 email sends per month, or Pro for 50,000.',
  },
  {
    free: 0,
    key: 'remove_branding',
    label: 'Remove Branding',
    pro: 1,
    starter: 0,
    unit: '',
    upgradeDescription: 'Remove "Powered by" branding on the Pro plan.',
  },
  {
    free: 0,
    key: 'priority_build',
    label: 'Priority Build',
    pro: 1,
    starter: 0,
    unit: '',
    upgradeDescription: 'Priority build queue on the Pro plan.',
  },
]);

/** Helper to pick the correct property from a FeatureLimit for a given plan. */
function limitForPlan(feature: FeatureLimit, plan: PlanTier): number {
  switch (plan) {
    case 'pro':
      return feature.pro;
    case 'starter':
      return feature.starter;
    default:
      return feature.free;
  }
}

/** Helper to find a FeatureLimit by key. Never throws — returns undefined for unknown keys. */
function findFeature(feature: FeatureKey): FeatureLimit | undefined {
  return FEATURE_MATRIX.find((f) => f.key === feature);
}

/**
 * Resolve the numeric limit for a feature on a given plan. Returns 0 for
 * unknown features or missing entries.
 *
 * @param feature - The feature key.
 * @param plan - The plan tier.
 * @returns The limit (`-1` means unlimited; `0` means unavailable).
 *
 * @example
 * getLimit('sites', 'free')       // 1
 * getLimit('sites', 'pro')        // -1 (unlimited)
 * getLimit('custom_domain', 'free') // 0
 */
export function getLimit(feature: FeatureKey, plan: PlanTier): number {
  const entry = findFeature(feature);
  if (!entry) return 0;
  return limitForPlan(entry, plan);
}

/**
 * Return the human-readable label for a feature key. Falls back to the key
 * itself for unknown features.
 *
 * @param feature - The feature key.
 * @returns The display label.
 *
 * @example
 * getFeatureLabel('ai_credits') // "AI Credits"
 */
export function getFeatureLabel(feature: FeatureKey): string {
  const entry = findFeature(feature);
  return entry?.label ?? feature;
}

/**
 * Check whether a feature is available on a given plan. A feature is
 * available when its limit is either greater than zero or `-1` (unlimited).
 *
 * @param feature - The feature key.
 * @param plan - The plan tier.
 * @returns True if the feature is usable on this plan.
 *
 * @example
 * isFeatureAvailable('custom_domain', 'free')    // false (0)
 * isFeatureAvailable('custom_domain', 'starter') // true (1)
 * isFeatureAvailable('sites', 'pro')             // true (-1)
 */
export function isFeatureAvailable(feature: FeatureKey, plan: PlanTier): boolean {
  const limit = getLimit(feature, plan);
  return limit > 0 || limit === -1;
}

/**
 * Produce a human-readable usage string for a feature on a given plan.
 * Works for both limited and unlimited features.
 *
 * @param feature - The feature key.
 * @param plan - The plan tier.
 * @param used - How many units of the feature have been consumed (always >= 0).
 * @returns A description like "2 of 5 builds used" or "Unlimited sites".
 *
 * @example
 * usageDescription('builds_per_month', 'free', 3)  // "3 of 5 builds used"
 * usageDescription('sites', 'pro', 12)              // "12 sites (unlimited)"
 * usageDescription('custom_domain', 'free', 0)      // "0 of 0 custom domains used"
 */
export function usageDescription(feature: FeatureKey, plan: PlanTier, used: number): string {
  const entry = findFeature(feature);
  if (!entry) return `${Math.max(0, used)} of 0 used`;

  const limit = limitForPlan(entry, plan);
  const unit = entry.unit || entry.label.toLowerCase();
  const safeUsed = Math.max(0, used);

  if (limit === -1) {
    return `${safeUsed} ${unit} (unlimited)`;
  }

  return `${safeUsed} of ${limit} ${unit} used`;
}

/**
 * Normalize a plan string to a PlanTier. Case-insensitive; any unrecognised,
 * empty, or null/undefined input defaults to 'free'.
 *
 * @param input - The raw plan string from the billing system or user input.
 * @returns The normalised PlanTier (always 'free', 'starter', or 'pro').
 *
 * @example
 * normalizePlan('Starter') // 'starter'
 * normalizePlan('PRO')     // 'pro'
 * normalizePlan(null)      // 'free'
 * normalizePlan('gold')    // 'free'
 */
export function normalizePlan(input: string | null | undefined): PlanTier {
  if (!input) return 'free';

  switch (input.trim().toLowerCase()) {
    case 'starter':
      return 'starter';
    case 'pro':
      return 'pro';
    default:
      return 'free';
  }
}
