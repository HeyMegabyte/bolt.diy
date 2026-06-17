/**
 * Claim Lead Profile — researched business profile that prefills /create
 * and flows into Settings for the claimyour.site product line.
 *
 * @remarks
 * This module is pure (no network, no D1, no clock).  Every side-effect is
 * injected as a parameter so the full module is unit-testable with zero mocks
 * beyond what Jest provides by default.
 *
 * The shape mirrors what a business-research pipeline produces after crawling
 * Google Places, Yelp, Foursquare, or a source website.  The profile prefills
 * the /create form so the user sees real data immediately rather than blank
 * fields.  It also seeds Settings so subsequent edits layer on top of the
 * original research.
 *
 * @example
 * ```ts
 * import { ClaimLeadProfileSchema, toCreateFormPrefill, mergeRebuildContext } from './claim_lead_profile.js';
 *
 * const raw = await fetchResearchData(placeId);
 * const profile = ClaimLeadProfileSchema.parse(raw);
 * const prefill = toCreateFormPrefill(profile);
 * // pass prefill to the /create form as initial values
 * ```
 *
 * @see {@link ClaimLeadProfileSchema} for the Zod schema
 * @see {@link toCreateFormPrefill} for /create form integration
 * @see {@link mergeRebuildContext} for settings-merge workflow
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Zod schema for a researched lead profile.
 *
 * @remarks
 * `businessName` is the only required field — every other property is optional
 * because research pipelines operate at varying levels of completeness.
 * `.strict()` rejects unknown keys so callers never accidentally pass
 * database columns or raw API payloads through unvalidated.
 *
 * @example
 * ```ts
 * const profile = ClaimLeadProfileSchema.parse({ businessName: 'Acme Corp', city: 'Newark' });
 * ```
 *
 * @throws {z.ZodError} when the input is invalid
 */
export const ClaimLeadProfileSchema = z
  .object({
    /** Display name of the business (required). */
    businessName: z.string().min(1),

    /** Contact phone number (E.164 recommended). */
    phone: z.string().optional(),

    /** Business contact email address. */
    email: z.string().optional(),

    /** Street address line. */
    address: z.string().optional(),

    /** City. */
    city: z.string().optional(),

    /** State or province code. */
    state: z.string().optional(),

    /** Postal / ZIP code. */
    postal: z.string().optional(),

    /** ISO 3166-1 alpha-2 country code. */
    country: z.string().optional(),

    /** Business category (e.g. "salon", "restaurant", "nonprofit"). */
    category: z.string().optional(),

    /** Short prose description of the business. */
    description: z.string().optional(),

    /** List of offered services or products. */
    services: z.array(z.string()).optional(),

    /** Human-readable operating hours (e.g. "Mon-Sat 9am-6pm"). */
    hours: z.string().optional(),

    /** Google Maps or equivalent URL for the location. */
    mapsUrl: z.string().optional(),

    /** URL of the business's existing website (if any). */
    existingWebsite: z.string().optional(),

    /** URL of the brand logo discovered during research. */
    logoUrl: z.string().optional(),

    /** Suggested primary CTA copy (e.g. "Book an appointment"). */
    cta: z.string().optional(),

    /** Prose description of the ideal customer. */
    targetCustomer: z.string().optional(),

    /** Brand voice tone hint (e.g. "friendly and professional"). */
    tone: z.string().optional(),

    /** Freeform notes from the research pipeline for context. */
    notes: z.string().optional(),

    /**
     * Confidence score for the research data, between 0 and 1.
     * Higher values indicate more authoritative sourcing.
     */
    sourceConfidence: z.number().min(0).max(1).optional(),

    /**
     * Identifier for the lead source (e.g. "google-places", "yelp",
     * "manual", "scrape").
     */
    leadSource: z.string().optional(),
  })
  .strict();

/**
 * TypeScript type inferred from {@link ClaimLeadProfileSchema}.
 * Never hand-maintain this alongside the schema — rely on Zod's `z.infer`.
 */
export type ClaimLeadProfile = z.infer<typeof ClaimLeadProfileSchema>;

// ---------------------------------------------------------------------------
// toCreateFormPrefill
// ---------------------------------------------------------------------------

/**
 * Convert a validated {@link ClaimLeadProfile} into a flat object of initial
 * /create form values.
 *
 * @remarks
 * Only fields that are explicitly present (not `undefined`) are copied into
 * the output.  This ensures that optional fields left blank during research
 * do not overwrite user-entered defaults inside the form.
 *
 * @param profile - A validated lead profile.
 * @returns A flat `Record<string, unknown>` suitable for spreading into form
 *   initial values or a React `defaultValues` prop.
 *
 * @example
 * ```ts
 * const prefill = toCreateFormPrefill(profile);
 * // { businessName: 'Acme Corp', city: 'Newark' }
 * ```
 */
export function toCreateFormPrefill(profile: ClaimLeadProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// mergeRebuildContext
// ---------------------------------------------------------------------------

/**
 * Merge user edits on top of an existing {@link ClaimLeadProfile} and
 * re-validate the result.
 *
 * @remarks
 * This supports the Settings flow where a user reviews AI-researched data and
 * makes corrections.  Edits win on a per-key basis (last-write-wins).  The
 * merged object is re-validated through {@link ClaimLeadProfileSchema} so
 * callers always receive a type-safe, schema-compliant profile — or a thrown
 * `ZodError` when the merged data is invalid (e.g. `businessName: ''`).
 *
 * The original `profile` argument is **never mutated**; a new object is
 * always returned.
 *
 * @param profile - The current lead profile (baseline).
 * @param edits - A partial record of key-value pairs to apply on top.
 * @returns A new, re-validated {@link ClaimLeadProfile}.
 *
 * @throws {z.ZodError} when the merged object fails schema validation.
 *
 * @example
 * ```ts
 * const updated = mergeRebuildContext(existing, { city: 'Trenton', phone: '+16095550100' });
 * ```
 */
export function mergeRebuildContext(
  profile: ClaimLeadProfile,
  edits: Record<string, unknown>,
): ClaimLeadProfile {
  const merged = { ...profile, ...edits };
  // parse (not safeParse) so callers receive a thrown ZodError on failure
  return ClaimLeadProfileSchema.parse(merged);
}
