/**
 * Claim → site-generation parameter bridge (#1 — the generation-consumer keystone).
 *
 * @remarks
 * The claim funnel kicks the background build, but the SITE_WORKFLOW
 * ({@link SiteGenerationParams}) expects site-shaped params (siteId / slug /
 * businessName / …), NOT the claim-shaped `{sessionId, leadId, shortlink}` the
 * claim route currently passes. This pure mapping turns a researched
 * {@link ClaimLeadProfile} (+ the caller-created site identity) into the exact
 * params the real generation workflow consumes — the missing contract bridge.
 *
 * Caller responsibility: a site row must exist FIRST (createSite → siteId/slug/
 * orgId), then `buildClaimSiteParams(lead.profile, { siteId, slug, orgId })` →
 * `SITE_WORKFLOW.create({ params })`. On terminal status the build-status
 * callback calls `handleClaimBuildResult` to flip the claim session + email.
 *
 * @example
 * ```ts
 * const params = buildClaimSiteParams(lead.profile, { siteId, slug, orgId });
 * await env.SITE_WORKFLOW.create({ id: siteId, params });
 * ```
 *
 * @packageDocumentation
 */
import type { ClaimLeadProfile } from './claim_lead_profile.js';
import type { SiteGenerationParams } from '../workflows/site-generation.js';

/** The site identity the caller has already provisioned (createSite). */
export interface ClaimSiteParamsOpts {
  siteId: string;
  slug: string;
  orgId: string;
  /** Optional Google Place id when the lead came from a Places scan. */
  googlePlaceId?: string;
}

/** Join present, trimmed address parts into one line. */
function composeAddress(p: ClaimLeadProfile): string | undefined {
  const line = [p.address, p.city, p.state, p.postal].map((s) => s?.trim()).filter(Boolean);
  return line.length > 0 ? line.join(', ') : undefined;
}

/** Fold the rich profile fields (description / services / hours / maps) into the
 *  free-text generation context so the build prompt has ground truth to work with. */
function composeContext(p: ClaimLeadProfile): string | undefined {
  const parts: string[] = [];
  if (p.description?.trim()) parts.push(p.description.trim());
  if (p.services && p.services.length > 0) parts.push(`Services: ${p.services.join(', ')}`);
  if (p.hours?.trim()) parts.push(`Hours: ${p.hours.trim()}`);
  if (p.mapsUrl?.trim()) parts.push(`Map: ${p.mapsUrl.trim()}`);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Map a researched lead profile + a provisioned site identity to the exact
 * {@link SiteGenerationParams} the SITE_WORKFLOW consumes.
 *
 * @param profile - The researched {@link ClaimLeadProfile} (businessName required).
 * @param opts    - The already-created site's `siteId` / `slug` / `orgId`.
 * @returns Workflow-ready params; only present fields are set (no empty strings).
 */
export function buildClaimSiteParams(
  profile: ClaimLeadProfile,
  opts: ClaimSiteParamsOpts,
): SiteGenerationParams {
  const params: SiteGenerationParams = {
    siteId: opts.siteId,
    slug: opts.slug,
    orgId: opts.orgId,
    businessName: profile.businessName,
  };

  const address = composeAddress(profile);
  if (address) params.businessAddress = address;
  if (profile.phone?.trim()) params.businessPhone = profile.phone.trim();
  if (profile.category?.trim()) params.businessCategory = profile.category.trim();
  if (profile.existingWebsite?.trim()) params.businessWebsite = profile.existingWebsite.trim();
  if (opts.googlePlaceId?.trim()) params.googlePlaceId = opts.googlePlaceId.trim();

  const context = composeContext(profile);
  if (context) params.additionalContext = context;

  return params;
}
