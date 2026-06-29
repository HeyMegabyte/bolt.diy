/**
 * @module services/plan_gate_crm
 * @description TW24 — CRM feature entitlements gated by plan tier. Pure,
 * zero-I/O entitlement matrix that the CRM admin UI and API handlers consult
 * before enabling CRM features. Never throws.
 *
 * @packageDocumentation
 */

/** CRM-specific feature keys that can be gated by plan. */
export type CrmFeature =
  | 'crm_access'
  | 'contacts_unlimited'
  | 'deals'
  | 'workflows'
  | 'email_timeline'
  | 'ai_scoring';

/** CRM entitlements derived from the current plan tier. */
export interface CrmEntitlements {
  /** Map of feature key to boolean availability. */
  readonly features: Record<CrmFeature, boolean>;
  /** Maximum contacts allowed (-1 = unlimited). */
  readonly maxContacts: number;
  /** Maximum deals allowed (-1 = unlimited). */
  readonly maxDeals: number;
}

/** The three plan tiers that determine CRM entitlements. */
type PlanTier = 'free' | 'starter' | 'pro';

/**
 * Per-plan CRM entitlement matrix. Immutable.
 *
 * - free:    no CRM access, all features false, 0 contacts, 0 deals.
 * - starter: CRM access with 500 contacts, 100 deals. No workflows, email_timeline,
 *            or ai_scoring.
 * - pro:     all features, unlimited contacts and deals (-1).
 */
function freezeEntitlements(e: CrmEntitlements): CrmEntitlements {
  return Object.freeze({ ...e, features: Object.freeze(e.features) });
}

export const CRM_ENTITLEMENTS: Readonly<Record<PlanTier, CrmEntitlements>> = Object.freeze({
  free: freezeEntitlements({
    features: {
      ai_scoring: false,
      contacts_unlimited: false,
      crm_access: false,
      deals: false,
      email_timeline: false,
      workflows: false,
    },
    maxContacts: 0,
    maxDeals: 0,
  }),
  pro: freezeEntitlements({
    features: {
      ai_scoring: true,
      contacts_unlimited: true,
      crm_access: true,
      deals: true,
      email_timeline: true,
      workflows: true,
    },
    maxContacts: -1,
    maxDeals: -1,
  }),
  starter: freezeEntitlements({
    features: {
      ai_scoring: false,
      contacts_unlimited: false,
      crm_access: true,
      deals: true,
      email_timeline: false,
      workflows: false,
    },
    maxContacts: 500,
    maxDeals: 100,
  }),
});

/**
 * Normalize a plan string to a PlanTier. Case-insensitive; any unrecognised,
 * empty, or null/undefined input defaults to 'free'.
 *
 * @param input - The raw plan string from the billing system or user input.
 * @returns The normalised PlanTier (always 'free', 'starter', or 'pro').
 */
function normalizePlan(input: string | null | undefined): PlanTier {
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

/**
 * Resolve CRM entitlements for a given plan. Pure function — always returns
 * a valid CrmEntitlements object, never throws.
 *
 * @param plan - The plan string from billing (case-insensitive, null-safe).
 * @returns The CRM entitlements for that plan.
 *
 * @example
 * const ent = crmEntitlements('free');
 * // { features: { crm_access: false, ... }, maxContacts: 0, maxDeals: 0 }
 *
 * @example
 * const ent = crmEntitlements('pro');
 * // { features: { crm_access: true, ... }, maxContacts: -1, maxDeals: -1 }
 * // ent.features.workflows === true
 * // ent.features.ai_scoring === true
 */
export function crmEntitlements(plan: string | null | undefined): CrmEntitlements {
  const tier = normalizePlan(plan);
  return CRM_ENTITLEMENTS[tier];
}
