/**
 * @module services/compliance_check
 * @description GDPR/EU data-residency compliance check engine. A pure, deterministic
 * rule engine that checks whether a site/store configuration violates GDPR or
 * data-residency rules. No API calls — pure functional evaluation.
 *
 * @packageDocumentation
 */

/** Input to the compliance check for one site/store configuration. */
export interface ComplianceInput {
  /** Whether the site provides a data-deletion endpoint for users. */
  hasConsentBanner: boolean;
  /** Whether the site provides a data-export endpoint for users. */
  hasDataDeletion: boolean;
  /** Whether the site provides a data-export endpoint for users. */
  hasDataExport: boolean;
  /** Two-letter ISO country code or region code (eu, us, us-ca, gb, br, au, jp). */
  jurisdiction: string;
  /** Whether the site stores any personally identifiable information. */
  storesPii: boolean;
  /** Whether the site uses third-party tracking (analytics, ads, pixels). */
  usesThirdPartyTracking: boolean;
}

/** Result of a compliance check for one site. */
export interface ComplianceResult {
  /** True when the configuration passes all rules for its jurisdiction. */
  pass: boolean;
  /** Human-readable required actions to fix the violations. */
  requiredActions: string[];
  /** Human-readable violation descriptions (empty when pass is true). */
  violations: string[];
}

/** A jurisdiction's static compliance rules. */
export interface JurisdictionRule {
  /** Where data must be stored. null means no residency restriction. */
  dataResidency: string | null;
  /** Whether cookie/consent banners are required. */
  requiresConsent: boolean;
  /** Whether a Data Processing Agreement with third parties is required. */
  requiresDpa: boolean;
}

/**
 * Known jurisdiction rules. Each entry defines the consent, DPA, and data-residency
 * requirements for that jurisdiction under its primary privacy framework.
 */
export const JURISDICTION_RULES: Record<string, JurisdictionRule> = Object.freeze({
  /** Australia — Privacy Act 1988. No EU-style consent mandate. */
  au: Object.freeze({ dataResidency: 'AU', requiresConsent: false, requiresDpa: false }),
  /** Brazil — LGPD. Consent + data in BR. */
  br: Object.freeze({ dataResidency: 'BR', requiresConsent: true, requiresDpa: false }),
  /** European Union — GDPR. Consent + DPA + data in EU. */
  eu: Object.freeze({ dataResidency: 'EU', requiresConsent: true, requiresDpa: true }),
  /** United Kingdom — UK GDPR (equivalent). Consent + DPA + data in GB/EU. */
  gb: Object.freeze({ dataResidency: 'EU', requiresConsent: true, requiresDpa: true }),
  /** Japan — APPI. No EU-style consent mandate for basic operation. */
  jp: Object.freeze({ dataResidency: 'JP', requiresConsent: false, requiresDpa: false }),
  /** United States (other states) — no comprehensive federal privacy law. */
  us: Object.freeze({ dataResidency: 'US', requiresConsent: false, requiresDpa: false }),
  /** California, USA — CCPA. Limited opt-out consent. */
  'us-ca': Object.freeze({ dataResidency: 'US', requiresConsent: true, requiresDpa: false }),
});

/** Default rules used when the jurisdiction is unknown or unmapped. */
const FALLBACK_RULES: JurisdictionRule = Object.freeze({
  dataResidency: null,
  requiresConsent: false,
  requiresDpa: false,
});

/**
 * Evaluate a site/store configuration against GDPR, LGPD, CCPA, and other
 * data-residency rules. Pure + deterministic; never throws. An unknown or
 * unmapped jurisdiction is treated as minimal (no violations).
 *
 * @param input - The site/store configuration to evaluate.
 * @returns The {@link ComplianceResult} assessment.
 *
 * @example
 * checkCompliance({
 *   jurisdiction: 'eu',
 *   storesPii: true,
 *   hasConsentBanner: false,
 *   hasDataExport: false,
 *   hasDataDeletion: false,
 *   usesThirdPartyTracking: true,
 * });
 * // → { pass: false, violations: [...], requiredActions: [...] }
 */
export function checkCompliance(input: ComplianceInput): ComplianceResult {
  const rules = JURISDICTION_RULES[input.jurisdiction] ?? FALLBACK_RULES;
  const violations: string[] = [];
  const requiredActions: string[] = [];

  // Consent banner check (GDPR, LGPD, CCPA)
  if (rules.requiresConsent && input.storesPii && !input.hasConsentBanner) {
    violations.push('consent banner required but missing');
    requiredActions.push('add a cookie/consent banner to capture opt-in before processing PII');
  }

  // Third-party tracking consent (GDPR, LGPD)
  if (rules.requiresConsent && input.usesThirdPartyTracking && !input.hasConsentBanner) {
    violations.push('third-party tracking used without consent banner');
    requiredActions.push('block third-party tracking scripts until user gives consent');
  }

  // DPA requirement (GDPR only)
  if (rules.requiresDpa && input.usesThirdPartyTracking) {
    violations.push('Data Processing Agreement required for third-party services');
    requiredActions.push('sign a DPA with each third-party data processor (analytics, ads, etc.)');
  }

  // Data-export right (GDPR, LGPD, CCPA)
  if (rules.requiresConsent && input.storesPii && !input.hasDataExport) {
    violations.push('data export endpoint required but missing');
    requiredActions.push('implement a user-facing data export endpoint to satisfy access rights');
  }

  // Data-deletion right (GDPR, LGPD, CCPA)
  if (rules.requiresConsent && input.storesPii && !input.hasDataDeletion) {
    violations.push('data deletion endpoint required but missing');
    requiredActions.push(
      'implement a user-facing data deletion endpoint to satisfy erasure rights',
    );
  }

  // Data-residency requirement (infrastructure guidance, not a config violation)
  if (rules.dataResidency && input.storesPii) {
    requiredActions.push(
      `ensure all PII storage (database, cache, backups) is in ${rules.dataResidency}`,
    );
  }

  return {
    pass: violations.length === 0,
    requiredActions,
    violations,
  };
}
