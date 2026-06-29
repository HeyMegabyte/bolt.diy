/**
 * @module services/feature_gate
 * @description Plan-gated feature access evaluator. Pure — zero I/O. Replaces
 * scattered `if plan==='pro'` branches with a single typed matrix. Unknown
 * features or plans return safe defaults (false / empty array).
 *
 * @packageDocumentation
 */

/** The seven feature-gated capabilities. */
export type Feature =
  | 'analytics_export'
  | 'custom_domain'
  | 'remove_branding'
  | 'priority_support'
  | 'api_access'
  | 'team_seats'
  | 'white_label';

/** Per-feature availability across all three plan tiers. */
export interface FeatureGate {
  /** Immutable feature key — matches the union literal. */
  readonly feature: Feature;
  /** Available on the Free plan. */
  readonly free: boolean;
  /** Available on the Starter plan. */
  readonly starter: boolean;
  /** Available on the Pro plan. */
  readonly pro: boolean;
}

/**
 * Canonical feature gate matrix. Immutable — single source of truth for all
 * plan-gated boolean feature access.
 *
 * - free:     0 features enabled
 * - starter:  custom_domain + analytics_export
 * - pro:      all 7 features
 */
export const FEATURE_GATES: readonly FeatureGate[] = Object.freeze([
  { feature: 'analytics_export', free: false, starter: true, pro: true },
  { feature: 'custom_domain', free: false, starter: true, pro: true },
  { feature: 'remove_branding', free: false, starter: false, pro: true },
  { feature: 'priority_support', free: false, starter: false, pro: true },
  { feature: 'api_access', free: false, starter: false, pro: true },
  { feature: 'team_seats', free: false, starter: false, pro: true },
  { feature: 'white_label', free: false, starter: false, pro: true },
]);

/** Helper to find a FeatureGate by key. Never throws — returns undefined for unknown keys. */
function findGate(feature: Feature): FeatureGate | undefined {
  return FEATURE_GATES.find((g) => g.feature === feature);
}

/**
 * Check whether a feature is enabled on the given plan. Case-insensitive plan
 * matching; any unrecognised plan defaults to 'free'. Unknown features always
 * return false and never throw.
 *
 * @param feature - The feature key.
 * @param plan - The plan identifier (e.g. 'free', 'starter', 'pro').
 * @returns True if the feature is available on this plan.
 *
 * @example
 * featureEnabled('custom_domain', 'free')    // false
 * featureEnabled('custom_domain', 'starter') // true
 * featureEnabled('remove_branding', 'pro')   // true
 * featureEnabled('unknown_feature', 'pro')   // false (never throws)
 */
export function featureEnabled(feature: Feature, plan: string): boolean {
  const gate = findGate(feature);
  if (!gate) return false;

  switch (plan.trim().toLowerCase()) {
    case 'pro':
      return gate.pro;
    case 'starter':
      return gate.starter;
    default:
      return gate.free;
  }
}

/**
 * List every feature that is enabled on the given plan. Case-insensitive plan
 * matching; unrecognised plans return the free-tier set (empty array).
 *
 * @param plan - The plan identifier (e.g. 'free', 'starter', 'pro').
 * @returns An array of enabled feature keys.
 *
 * @example
 * listEnabled('free')    // []
 * listEnabled('starter') // ['analytics_export', 'custom_domain']
 * listEnabled('pro')     // ['analytics_export', 'custom_domain', 'remove_branding', ...]
 */
export function listEnabled(plan: string): Feature[] {
  const normalised = plan.trim().toLowerCase();

  return FEATURE_GATES.filter((g) => {
    switch (normalised) {
      case 'pro':
        return g.pro;
      case 'starter':
        return g.starter;
      default:
        return g.free;
    }
  }).map((g) => g.feature);
}
