/**
 * @module services/plan_provision
 * @description A8 (#123) — plan-based feature provisioning matrix. Pure zero-I/O
 * resolver for which named features are included per plan tier and a bulk
 * provision/skip/error splitter for feature deployment. Never throws — unknown
 * plans return empty sets; unknown features within a known plan are ignored.
 *
 * @packageDocumentation
 */

import type { PlanTier } from './plan_entitlement.js';

/** The seven deployable feature keys. */
export type ProvisionFeature =
  | 'custom_domain'
  | 'analytics_export'
  | 'remove_branding'
  | 'priority_build'
  | 'advanced_seo'
  | 'premium_support'
  | 'form_builder';

/** Request to provision a set of features for a plan + org. */
export interface ProvisionRequest {
  /** The billing plan tier. */
  readonly plan: string;
  /** Feature keys the caller wants to provision. */
  readonly features: readonly string[];
  /** The target organisation id. */
  readonly orgId: string;
}

/** Result of a provision attempt. */
export interface ProvisionResult {
  /** Features successfully provisioned (belong to the plan). */
  readonly provisioned: readonly string[];
  /** Features skipped (not available on this plan or unknown). */
  readonly skipped: readonly string[];
  /** Errors encountered during provisioning (currently unused; reserved). */
  readonly errors: readonly string[];
}

/**
 * Canonical mapping from plan tier to deployable features.
 *
 * - free:     no deployable features.
 * - starter:  custom_domain + analytics_export.
 * - pro:      all 7 features.
 */
export const PLAN_FEATURES: Readonly<Record<PlanTier, readonly ProvisionFeature[]>> = {
  free: Object.freeze([]),
  pro: Object.freeze([
    'custom_domain',
    'analytics_export',
    'remove_branding',
    'priority_build',
    'advanced_seo',
    'premium_support',
    'form_builder',
  ]),
  starter: Object.freeze(['custom_domain', 'analytics_export']),
};

/**
 * All recognised feature keys. Acts as an allow-list for the provisioner.
 */
export const ALL_FEATURES: readonly ProvisionFeature[] = Object.freeze([
  'custom_domain',
  'analytics_export',
  'remove_branding',
  'priority_build',
  'advanced_seo',
  'premium_support',
  'form_builder',
]);

/**
 * Return the set of deployable feature keys for a given plan tier.
 * Unknown plans (or free) return an empty list.
 *
 * @param plan - The plan tier string (case-insensitive; e.g. 'starter', 'pro').
 * @returns The sorted list of provisionable feature keys for that plan.
 *
 * @example
 * planFeatures('free')        // []
 * planFeatures('starter')     // ['custom_domain', 'analytics_export']
 * planFeatures('pro')         // ['custom_domain', 'analytics_export', …] (7)
 * planFeatures('enterprise')  // []
 */
export function planFeatures(plan: string): readonly string[] {
  const tier = normalizePlanTier(plan);
  return PLAN_FEATURES[tier];
}

/**
 * Provision the requested features for a given plan + org. Each requested
 * feature is classified into {@link ProvisionResult.provisioned provisioned}
 * (belongs to the plan and is a known feature) or
 * {@link ProvisionResult.skipped skipped} (not available on the plan or
 * unknown). The result is purely computed from the plan matrix — no I/O occurs.
 *
 * @param request - The provision request containing plan, feature list, and orgId.
 * @returns A provision result with split provisioned / skipped / errors arrays.
 *
 * @example
 * provision({ plan: 'starter', features: ['custom_domain', 'advanced_seo', 'unknown_x'], orgId: 'org_1' })
 * // { provisioned: ['custom_domain'], skipped: ['advanced_seo', 'unknown_x'], errors: [] }
 *
 * @example
 * provision({ plan: 'free', features: ['custom_domain'], orgId: 'org_2' })
 * // { provisioned: [], skipped: ['custom_domain'], errors: [] }
 */
export function provision(request: ProvisionRequest): ProvisionResult {
  const available = new Set(planFeatures(request.plan));

  const provisioned: string[] = [];
  const skipped: string[] = [];

  for (const key of request.features) {
    if (available.has(key as ProvisionFeature)) {
      provisioned.push(key);
    } else {
      skipped.push(key);
    }
  }

  return {
    errors: Object.freeze([]),
    provisioned: Object.freeze(provisioned),
    skipped: Object.freeze(skipped),
  };
}

/**
 * Normalise a plan string to a PlanTier. Case-insensitive; any unrecognised,
 * empty, or null/undefined input defaults to 'free'.
 *
 * @param input - The raw plan string.
 * @returns The normalised PlanTier (always 'free', 'starter', or 'pro').
 *
 * @example
 * normalizePlanTier('Starter') // 'starter'
 * normalizePlanTier('PRO')     // 'pro'
 * normalizePlanTier(null)      // 'free'
 */
function normalizePlanTier(input: string | null | undefined): PlanTier {
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
