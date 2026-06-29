/**
 * @module services/domain_entitlement
 * @description A6 (#113) — custom domain + auto-TLS entitlement checker. Pure
 * zero-I/O entitlement matrix that the domains service and admin UI consult
 * before provisioning a custom hostname or enabling TLS features. Never throws.
 *
 * @packageDocumentation
 */

/** The three plan tiers that determine domain entitlements. */
export type PlanTier = 'free' | 'starter' | 'pro';

/** Domain-specific entitlements for a given plan. */
export interface DomainEntitlements {
  /** Max custom domains allowed: 0 (free), 1 (starter), -1 unlimited (pro). */
  readonly customDomains: number;
  /** Whether automatic TLS is provided. */
  readonly autoTls: boolean;
  /** Whether a custom return-path subdomain (e.g. send@custom.example.com) is allowed. */
  readonly customReturnPath: boolean;
  /** Whether DNS setup instructions are shown in the admin UI. */
  readonly dnsRecords: boolean;
}

/**
 * Per-plan entitlement matrix. Immutable — treat as source of truth.
 *
 * - free:    0 custom domains, no auto-TLS, no custom return path, DNS instructions yes.
 * - starter: 1 custom domain, auto-TLS yes, no custom return path, DNS instructions yes.
 * - pro:     unlimited custom domains, auto-TLS yes, custom return path yes, DNS instructions yes.
 */
export const ENTITLEMENTS: Readonly<Record<PlanTier, DomainEntitlements>> = {
  free: {
    autoTls: false,
    customDomains: 0,
    customReturnPath: false,
    dnsRecords: true,
  },
  pro: {
    autoTls: true,
    customDomains: -1,
    customReturnPath: true,
    dnsRecords: true,
  },
  starter: {
    autoTls: true,
    customDomains: 1,
    customReturnPath: false,
    dnsRecords: true,
  },
};

/**
 * Check whether a plan can add more custom domains. Free plans can never add.
 * Starter plans are capped at 1. Pro plans have a practical cap of 50.
 *
 * @param plan - The current plan tier.
 * @param currentCount - Number of custom domains already provisioned.
 * @returns True if the site can add another custom domain, false otherwise.
 */
export function canAddDomain(plan: PlanTier, currentCount: number): boolean {
  if (plan === 'free') return false;
  if (plan === 'starter') return currentCount < 1;
  // pro: practical cap of 50
  return currentCount < 50;
}

/**
 * Feature gate: whether this plan is allowed to set a custom domain as primary.
 * Free plans cannot; starter+pro plans can.
 *
 * @param plan - The current plan tier.
 * @returns True if the plan allows setting a primary custom domain.
 */
export function canSetPrimary(plan: PlanTier): boolean {
  return plan !== 'free';
}

/**
 * Return a short, honest upsell reason for a feature that is not available on the
 * given plan. Not marketing slop — just the facts.
 *
 * @param plan - The current plan tier.
 * @param feature - The feature being denied.
 * @returns A human-readable explanation of why the feature is unavailable.
 */
export function upsellReason(
  plan: PlanTier,
  feature: 'custom_domain' | 'auto_tls' | 'return_path',
): string {
  switch (feature) {
    case 'custom_domain':
      return 'Custom domains are available on the Starter plan.';
    case 'auto_tls':
      return 'Automatic TLS is available on the Starter plan.';
    case 'return_path':
      return 'Custom return paths are available on the Pro plan.';
  }
}

/**
 * Normalize a plan string to a PlanTier. Case-insensitive; any unrecognised,
 * empty, or null/undefined input defaults to 'free'.
 *
 * @param input - The raw plan string from the billing system or user input.
 * @returns The normalised PlanTier (always 'free', 'starter', or 'pro').
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
