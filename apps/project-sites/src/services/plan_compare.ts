/**
 * @module services/plan_compare
 * @description Pure plan comparison and recommendation functions.
 *
 * Compares plans side by side, returns the canonical feature matrix in a
 * structured format, and recommends the cheapest plan that satisfies a set
 * of user-specified needs. Zero I/O — every function is a deterministic
 * function of its typed inputs.
 *
 * ## Exports
 *
 * | Function | Returns | Use case |
 * |---|---|---|
 * | `comparePlans(planA, planB)` | `{ differences, upgrade, cost }` | Side-by-side diff for upgrade/downgrade UI |
 * | `planFeatureMatrix()` | `PlanFeatureRow[]` | Read-only matrix for display or API |
 * | `bestPlanFor(needs)` | `{ plan, reason }` | Cheapest plan meeting all feature minimums |
 *
 * @packageDocumentation
 */

import {
  FEATURE_MATRIX,
  type FeatureKey,
  getLimit,
  normalizePlan,
  type PlanTier,
} from './plan_entitlement.js';

// ── Pricing (cents per month) ──────────────────────────────────────────────

/**
 * Monthly prices per plan tier in cents.
 *
 * | Plan | Price |
 * |---|---:|
 * | free | $0 |
 * | starter | $25 |
 * | pro | $50 |
 */
export const PLAN_PRICES: Record<PlanTier, number> = {
  free: 0,
  pro: 5000,
  starter: 2500,
} as const;

/** Human-readable labels for each plan tier. */
export const PLAN_LABELS: Record<PlanTier, string> = {
  free: 'Free',
  pro: 'Pro',
  starter: 'Starter',
};

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * A single row in the plan feature matrix — a feature's limit across all
 * three plan tiers with metadata.
 */
export interface PlanFeatureRow {
  /** Feature key. */
  readonly key: FeatureKey;
  /** Human-readable label (e.g. "Sites"). */
  readonly label: string;
  /** Limit on the Free plan (`0` = unavailable, `-1` = unlimited). */
  readonly free: number;
  /** Limit on the Starter plan. */
  readonly starter: number;
  /** Limit on the Pro plan. */
  readonly pro: number;
  /** Unit suffix (e.g. "sites", "credits", "MB"). */
  readonly unit: string;
  /** Short upgrade pitch shown when the limit is reached. */
  readonly upgradeDescription: string;
}

/**
 * A single difference item between two plans.
 */
export interface FeatureDifference {
  /** The feature key. */
  readonly feature: FeatureKey;
  /** Human-readable feature label. */
  readonly label: string;
  /** Numeric limit on plan A (source plan). */
  readonly fromValue: number;
  /** Numeric limit on plan B (target plan). */
  readonly toValue: number;
  /** Verb describing the change. One of `'increase'`, `'decrease'`, or `'same'`. */
  readonly change: 'increase' | 'decrease' | 'same';
  /** Human-readable description of the difference. */
  readonly description: string;
}

/**
 * Cost summary for a plan switch.
 */
export interface PlanCostSummary {
  /** Monthly price of plan A in cents. */
  readonly fromCents: number;
  /** Monthly price of plan B in cents. */
  readonly toCents: number;
  /** Price delta per month (planB − planA) in cents. Negative = savings. */
  readonly deltaCents: number;
  /** Human-readable cost string (e.g. "$0 → $25/mo, +$25/mo"). */
  readonly display: string;
}

/**
 * Result of comparing two plan tiers.
 */
export interface CompareResult {
  /** Feature-by-feature differences between the two plans. */
  readonly differences: readonly FeatureDifference[];
  /** Whether switching from planA to planB is an upgrade. */
  readonly upgrade: boolean;
  /** Cost comparison. */
  readonly cost: PlanCostSummary;
}

/**
 * Minimum feature requirements used by {@link bestPlanFor}.
 */
export interface FeatureNeeds {
  /** Minimum number of sites required. Default 1. */
  readonly minSites?: number;
  /** Minimum builds per month. Default 0. */
  readonly minBuildsPerMonth?: number;
  /** Minimum AI credits per month. Default 0. */
  readonly minAiCredits?: number;
  /** Number of custom domains required. Default 0. */
  readonly customDomains?: number;
  /** Minimum analytics history days. Default 0. */
  readonly minAnalyticsDays?: number;
  /** Minimum media storage in MB. Default 0. */
  readonly minMediaMb?: number;
  /** Minimum team seats. Default 1. */
  readonly teamSeats?: number;
  /** Minimum email sends per month. Default 0. */
  readonly minEmailSends?: number;
  /** Whether remove-branding is required. Default false. */
  readonly removeBranding?: boolean;
  /** Whether priority builds are required. Default false. */
  readonly priorityBuild?: boolean;
}

/**
 * Recommendation result from {@link bestPlanFor}.
 */
export interface PlanRecommendation {
  /** The recommended plan tier. */
  readonly plan: PlanTier;
  /** Human-readable reason for the recommendation. */
  readonly reason: string;
}

// ── Feature limit helpers ──────────────────────────────────────────────────

function formatValue(value: number, unit: string): string {
  if (value === -1) return 'Unlimited';
  return `${value} ${unit}`;
}

function describeChange(feature: string, from: number, to: number, unit: string): string {
  if (from === to) return `${feature}: no change`;
  if (to === -1) return `${feature}: ${formatValue(from, unit)} → Unlimited`;
  if (from === -1) return `${feature}: Unlimited → ${formatValue(to, unit)}`;
  return `${feature}: ${formatValue(from, unit)} → ${formatValue(to, unit)}`;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compare two plan tiers side-by-side and return feature differences, an
 * upgrade flag, and a cost summary.
 *
 * Both plan names are normalised via {@link normalizePlan}. Unknown plans
 * are treated as `'free'`.
 *
 * @param planA - Source plan (current plan).
 * @param planB - Target plan (plan to compare to).
 * @returns A {@link CompareResult} with differences, upgrade flag, and cost.
 *
 * @example
 * const result = comparePlans('free', 'pro');
 * // → {
 * //   differences: [{ feature:'sites', label:'Sites', fromValue:1, toValue:-1,
 * //                   change:'increase', description:'Sites: 1 sites → Unlimited' }, …],
 * //   upgrade: true,
 * //   cost: { fromCents:0, toCents:5000, deltaCents:5000, display:'$0 → $50/mo, +$50/mo' }
 * // }
 *
 * @example
 * comparePlans('pro', 'free');
 * // → { upgrade: false, cost: { deltaCents: -5000, display:'$50 → $0/mo, -$50/mo' }, … }
 *
 * @example
 * comparePlans('starter', 'starter');
 * // → { differences: [], upgrade: false, cost: { deltaCents: 0, display:'$25 → $25/mo' } }
 */
export function comparePlans(planA: string, planB: string): CompareResult {
  const a: PlanTier = normalizePlan(planA);
  const b: PlanTier = normalizePlan(planB);

  // Feature differences
  const differences: FeatureDifference[] = [];

  for (const feat of FEATURE_MATRIX) {
    const fromValue = getLimit(feat.key, a);
    const toValue = getLimit(feat.key, b);

    let change: 'increase' | 'decrease' | 'same' = 'same';
    if (toValue === -1 && fromValue !== -1) {
      // Going from a finite value to unlimited
      change = 'increase';
    } else if (fromValue === -1 && toValue !== -1) {
      // Going from unlimited to a finite value
      change = 'decrease';
    } else if (toValue > fromValue) {
      change = 'increase';
    } else if (toValue < fromValue) {
      change = 'decrease';
    }

    differences.push({
      change,
      description: describeChange(feat.label, fromValue, toValue, feat.unit),
      feature: feat.key,
      fromValue,
      label: feat.label,
      toValue,
    });
  }

  // Upgrade detection
  const upgrade = isUpgrade(a, b);

  // Cost
  const fromCents = PLAN_PRICES[a];
  const toCents = PLAN_PRICES[b];
  const deltaCents = toCents - fromCents;

  let display: string;
  if (deltaCents > 0) {
    display = `$${fromCents / 100} → $${toCents / 100}/mo, +$${deltaCents / 100}/mo`;
  } else if (deltaCents < 0) {
    display = `$${fromCents / 100} → $${toCents / 100}/mo, -$${Math.abs(deltaCents) / 100}/mo`;
  } else {
    display = `$${fromCents / 100} → $${toCents / 100}/mo`;
  }

  return {
    cost: { deltaCents, display, fromCents, toCents },
    differences,
    upgrade,
  };
}

/**
 * Return the canonical plan feature matrix as a structured row array.
 *
 * Each row represents one feature with its per-plan limits, unit, and an
 * upgrade-description string. This is a pass-through that re-exports the
 * canonical `FEATURE_MATRIX` in a shape suited for API/display consumption.
 *
 * @returns An array of {@link PlanFeatureRow} — one per feature.
 *
 * @example
 * const matrix = planFeatureMatrix();
 * matrix.find(r => r.key === 'sites');
 * // → { key:'sites', label:'Sites', free:1, starter:3, pro:-1, unit:'sites', upgradeDescription:'…' }
 */
export function planFeatureMatrix(): readonly PlanFeatureRow[] {
  return FEATURE_MATRIX.map((f) => ({
    free: f.free,
    key: f.key,
    label: f.label,
    pro: f.pro,
    starter: f.starter,
    unit: f.unit,
    upgradeDescription: f.upgradeDescription,
  }));
}

/**
 * Recommend the cheapest plan that satisfies all feature needs specified in
 * `needs`. Returns `free` when the needs match (or are below) the free tier
 * limits, `starter` when the free tier falls short, and `pro` when starter
 * cannot cover the requirements.
 *
 * A need for unlimited (`-1`) capabilities only exists on the Pro tier.
 *
 * @param needs - Minimum feature requirements. Unspecified fields default to
 *                sensible minimums (e.g. 1 min site, 1 team seat).
 * @returns A {@link PlanRecommendation} with the recommended plan and a
 *          human-readable reason.
 *
 * @example
 * bestPlanFor({ minSites: 5, minAiCredits: 100 });
 * // → { plan:'starter', reason:'Starter covers 5 of 5 sites and 500 of 100 AI credits.' }
 *
 * @example
 * bestPlanFor({ customDomains: 3, removeBranding: true });
 * // → { plan:'pro', reason:'Pro covers 3 of 3 custom domains and remove-branding.' }
 *
 * @example
 * bestPlanFor({ minSites: 1 });
 * // → { plan:'free', reason:'Free covers 1 of 1 sites.' }
 *
 * @example
 * bestPlanFor({ teamSeats: 20 });
 * // → { plan:'pro', reason:'Pro covers 10 of 20 team seats; starter only covers 2.' }
 */
export function bestPlanFor(needs: FeatureNeeds): PlanRecommendation {
  // Build a list of feature check entries
  interface NeedCheck {
    key: FeatureKey;
    label: string;
    required: number;
    unit: string;
  }

  const checks: NeedCheck[] = [
    { key: 'sites', label: 'Sites', required: needs.minSites ?? 1, unit: 'sites' },
    {
      key: 'builds_per_month',
      label: 'Monthly builds',
      required: needs.minBuildsPerMonth ?? 0,
      unit: 'builds/mo',
    },
    {
      key: 'ai_credits',
      label: 'AI credits',
      required: needs.minAiCredits ?? 0,
      unit: 'credits/mo',
    },
    {
      key: 'custom_domain',
      label: 'Custom domains',
      required: needs.customDomains ?? 0,
      unit: 'domains',
    },
    {
      key: 'analytics_history_days',
      label: 'Analytics history',
      required: needs.minAnalyticsDays ?? 0,
      unit: 'days',
    },
    {
      key: 'media_storage_mb',
      label: 'Media storage',
      required: needs.minMediaMb ?? 0,
      unit: 'MB',
    },
    { key: 'team_seats', label: 'Team seats', required: needs.teamSeats ?? 1, unit: 'seats' },
    {
      key: 'email_sends_per_month',
      label: 'Email sends',
      required: needs.minEmailSends ?? 0,
      unit: 'sends/mo',
    },
  ];

  if (needs.removeBranding) {
    checks.push({ key: 'remove_branding', label: 'Remove branding', required: 1, unit: '' });
  }
  if (needs.priorityBuild) {
    checks.push({ key: 'priority_build', label: 'Priority builds', required: 1, unit: '' });
  }

  // Check each plan tier in ascending price order
  const tiers: PlanTier[] = ['free', 'starter', 'pro'];
  let failedLabel = '';

  for (const plan of tiers) {
    let allCovered = true;

    for (const check of checks) {
      const limit = getLimit(check.key, plan);
      const satisfied = limit === -1 || limit >= check.required;
      if (!satisfied) {
        allCovered = false;
        failedLabel = check.label;
        break;
      }
    }

    if (allCovered) {
      const coveredItems = checks
        .filter((c) => {
          const limit = getLimit(c.key, plan);
          return limit === -1 || limit >= c.required;
        })
        .map((c) => {
          const limit = getLimit(c.key, plan);
          const cap = limit === -1 ? 'unlimited' : `${limit}`;
          return `${c.label} (need ${c.required}, plan gives ${cap})`;
        });

      return {
        plan,
        reason: `${PLAN_LABELS[plan]} satisfies all requirements: ${coveredItems.join('; ')}.`,
      };
    }
  }

  // Fallback: even Pro can't cover it
  return {
    plan: 'pro',
    reason: `No plan fully covers all needs. Pro is the closest match — ${failedLabel} requirement exceeds the Pro tier limit.`,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Determine whether switching from `a` to `b` is an upgrade.
 */
function isUpgrade(a: PlanTier, b: PlanTier): boolean {
  const order: Record<PlanTier, number> = { free: 0, pro: 2, starter: 1 };
  return order[b] > order[a];
}
