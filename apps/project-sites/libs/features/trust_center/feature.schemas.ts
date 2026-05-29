/**
 * @module libs/features/trust_center/schemas
 *
 * Zod schemas for the Trust Center feature module.
 *
 * Public-facing shape is intentionally a subset of the admin shape so private
 * fields (custom_terms_md, contract metadata, internal notes) never leak via
 * `GET /api/public/trust/:siteSlug`.
 */

import { z } from 'zod';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const DataResidencySchema = z.enum(['global', 'us', 'eu', 'apac']);
export type DataResidency = z.infer<typeof DataResidencySchema>;

export const AuditLogPolicySchema = z.enum([
  'on-request',
  'self-serve',
  'realtime-stream',
]);
export type AuditLogPolicy = z.infer<typeof AuditLogPolicySchema>;

export const AiOutageBehaviorSchema = z.enum([
  'graceful-degradation',
  'queue-and-retry',
  'manual-fallback',
]);
export type AiOutageBehavior = z.infer<typeof AiOutageBehaviorSchema>;

// ─── Sub-schemas ─────────────────────────────────────────────────────────────

/**
 * One AI model the site uses. `purpose` is the user-visible reason
 * (e.g. "Content generation", "Image upscaling", "Voice transcription").
 */
export const AiModelEntrySchema = z.object({
  vendor: z.string().min(1).max(80),
  model: z.string().min(1).max(120),
  version: z.string().max(40).optional(),
  purpose: z.string().min(1).max(200),
  // Optional href to the provider's model card or data-use policy
  policy_url: z.string().url().optional(),
});
export type AiModelEntry = z.infer<typeof AiModelEntrySchema>;

/**
 * A content provenance entry — describes what fraction of content was AI
 * generated vs human authored, and the review process attached to it.
 */
export const ContentProvenanceEntrySchema = z.object({
  area: z.string().min(1).max(80), // e.g. 'homepage hero', 'blog posts'
  origin: z.enum(['ai-generated', 'human-authored', 'ai-assisted']),
  reviewed_by: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
});
export type ContentProvenanceEntry = z.infer<
  typeof ContentProvenanceEntrySchema
>;

// ─── Profile shapes ──────────────────────────────────────────────────────────

/** Persisted trust profile (mirrors `trust_profiles` row). */
export const TrustProfileSchema = z.object({
  id: z.string().min(1),
  org_id: z.string().min(1),
  site_id: z.string().min(1).nullable(),
  ai_models: z.array(AiModelEntrySchema).default([]),
  data_residency: DataResidencySchema.default('global'),
  audit_log_policy: AuditLogPolicySchema.default('on-request'),
  content_provenance: z.array(ContentProvenanceEntrySchema).default([]),
  ai_outage_behavior: AiOutageBehaviorSchema.default('graceful-degradation'),
  custom_disclosures: z.string().max(10_000).nullable().optional(),
  published: z.boolean().default(false),
  published_at: z.string().nullable().optional(),
  updated_at: z.string(),
});
export type TrustProfile = z.infer<typeof TrustProfileSchema>;

/** Input for `PUT /api/trust/profile` and `PUT /api/trust/site/:siteId`. */
export const TrustProfileUpdateSchema = z.object({
  ai_models: z.array(AiModelEntrySchema).max(50).optional(),
  data_residency: DataResidencySchema.optional(),
  audit_log_policy: AuditLogPolicySchema.optional(),
  content_provenance: z.array(ContentProvenanceEntrySchema).max(50).optional(),
  ai_outage_behavior: AiOutageBehaviorSchema.optional(),
  custom_disclosures: z.string().max(10_000).nullable().optional(),
});
export type TrustProfileUpdate = z.infer<typeof TrustProfileUpdateSchema>;

/**
 * Public, redacted view returned from `/api/public/trust/:siteSlug` and used
 * to render the public `/trust` route. Private fields removed.
 */
export const PublicTrustProfileSchema = z.object({
  site_slug: z.string().min(1),
  ai_models: z.array(AiModelEntrySchema),
  data_residency: DataResidencySchema,
  audit_log_policy: AuditLogPolicySchema,
  content_provenance: z.array(ContentProvenanceEntrySchema),
  ai_outage_behavior: AiOutageBehaviorSchema,
  custom_disclosures: z.string().nullable(),
  published_at: z.string().nullable(),
});
export type PublicTrustProfile = z.infer<typeof PublicTrustProfileSchema>;

/**
 * Strip private fields from a persisted profile for public consumption.
 * Pure function — no I/O — safe to test in isolation.
 */
export function toPublicProfile(
  profile: TrustProfile,
  siteSlug: string,
): PublicTrustProfile {
  return PublicTrustProfileSchema.parse({
    site_slug: siteSlug,
    ai_models: profile.ai_models,
    data_residency: profile.data_residency,
    audit_log_policy: profile.audit_log_policy,
    content_provenance: profile.content_provenance,
    ai_outage_behavior: profile.ai_outage_behavior,
    custom_disclosures: profile.custom_disclosures ?? null,
    published_at: profile.published_at ?? null,
  });
}

/**
 * Build a schema.org `DigitalDocument` JSON-LD block for the public trust
 * page. Spec: https://schema.org/DigitalDocument.
 *
 * The returned object is plain JSON; callers stringify + inject into a
 * `<script type="application/ld+json">` tag.
 */
export function buildTrustJsonLd(
  profile: PublicTrustProfile,
  opts: { siteUrl: string; businessName: string },
): Record<string, unknown> {
  const updated = profile.published_at ?? new Date().toISOString();
  return {
    '@context': 'https://schema.org',
    '@type': 'DigitalDocument',
    name: `${opts.businessName} — Trust Center`,
    url: `${opts.siteUrl.replace(/\/$/, '')}/trust`,
    inLanguage: 'en',
    datePublished: updated,
    dateModified: updated,
    about: {
      '@type': 'Thing',
      name: 'AI transparency, content provenance, and data-handling disclosures',
    },
    publisher: {
      '@type': 'Organization',
      name: opts.businessName,
    },
  };
}
