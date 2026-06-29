/**
 * @module libs/features/preview_share_card/service
 * @description #55 preview_share_card — feature-module service layer. Wraps the
 * pure `buildPreviewShareCard` core (`src/services/preview_share_card.ts`) with a
 * site-aware builder that derives the canonical preview URL from the slug. Pure +
 * zero-I/O; the handler resolves the owned site row and renders the card.
 *
 * @packageDocumentation
 */

import {
  buildPreviewShareCard,
  type PreviewShareCard,
} from '../../../src/services/preview_share_card.js';

/** Feature flag key gating this module. */
export const FLAG_KEY = 'preview_share_card';

/** The minimal owned-site fields the share card needs. */
export interface ShareCardSite {
  readonly slug: string;
  readonly businessName: string;
  /** Optional tagline used as the OG subtitle. */
  readonly tagline?: string | null;
  /**
   * Canonical public hostname (the active custom/primary domain). When present,
   * the share link uses it over the slug subdomain so owners share their real
   * branded URL, not the platform subdomain.
   */
  readonly primaryHostname?: string | null;
}

/**
 * Build a preview share-card for an owned site. The canonical preview URL is the
 * site's primary custom hostname when set, else the slug subdomain
 * (`{slug}.{baseDomain}`).
 *
 * @param site - {@link ShareCardSite} resolved from D1.
 * @param baseDomain - Apex domain for the slug-subdomain fallback (default `projectsites.dev`).
 * @returns The {@link PreviewShareCard} bundle.
 *
 * @example
 * buildShareCardForSite({ slug: 'vitos', businessName: "Vito's" }).links.copy
 * // → 'https://vitos.projectsites.dev'
 * buildShareCardForSite({ slug: 'vitos', businessName: "Vito's", primaryHostname: 'vitos.com' }).links.copy
 * // → 'https://vitos.com'
 */
export function buildShareCardForSite(
  site: ShareCardSite,
  baseDomain = 'projectsites.dev',
): PreviewShareCard {
  const host = (site.primaryHostname ?? '').trim();
  const slug = (site.slug ?? '').trim();
  const previewUrl = host ? `https://${host}` : slug ? `https://${slug}.${baseDomain}` : '';
  return buildPreviewShareCard({
    businessName: site.businessName,
    previewUrl,
    tagline: site.tagline ?? undefined,
  });
}
