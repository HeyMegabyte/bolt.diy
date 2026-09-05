/**
 * Lead scanner scoring — pure, no-network #9 signal engine.
 *
 * @remarks
 * Evaluates a Google Places-shaped record for lead quality.  Every function is
 * deterministic and side-effect-free; dependency-inject nothing because there
 * are no side-effects to inject.  The prime lead signal is the absence of a
 * website: a business without one is the ideal ProjectSites.dev customer.
 *
 * Score breakdown (0-100, clamped):
 * - No website     +45
 * - Has phone      +15
 * - Has reviews    +15  (userRatingsTotal > 0)
 * - Priority region +15
 * - Service type   +10  (types[] contains any service keyword)
 *
 * @example
 * ```ts
 * import { scoreLead } from './lead_scanner_score.js';
 *
 * const result = scoreLead({
 *   website: undefined,
 *   phone: '+12015551234',
 *   userRatingsTotal: 42,
 *   countryCode: 'US',
 *   types: ['plumber'],
 * });
 * // { hasWebsite: false, leadScore: 100, priority: true }
 * ```
 */

/** A Google Places-style record used as input for lead evaluation. */
export interface PlaceRecord {
  website?: string | null;
  phone?: string | null;
  rating?: number | null;
  userRatingsTotal?: number | null;
  types?: string[];
  countryCode?: string | null;
  /**
   * Discovered social profile URLs by network key (see `social_links.ts`). The
   * intent signal: an active social presence with NO website = a business that
   * has proven it wants to be online but hasn't built a site — the hottest lead.
   */
  socials?: Record<string, string> | null;
  /** Contact email (reachability signal). */
  email?: string | null;
}

// ---------------------------------------------------------------------------
// Region sets
// ---------------------------------------------------------------------------

const ENGLISH_SPEAKING_PRIORITY: ReadonlySet<string> = new Set([
  'US',
  'CA',
  'GB',
  'AU',
  'NZ',
  'IE',
]);

const WESTERN_EUROPE_PRIORITY: ReadonlySet<string> = new Set([
  'DE',
  'FR',
  'NL',
  'SE',
  'NO',
  'DK',
  'FI',
  'IE',
  'BE',
  'AT',
  'CH',
  'ES',
  'IT',
  'PT',
]);

// ---------------------------------------------------------------------------
// Service-type keywords that indicate a traditionally website-lacking business
// ---------------------------------------------------------------------------

const SERVICE_TYPE_KEYWORDS: ReadonlyArray<string> = [
  'plumber',
  'electrician',
  'roofing',
  'contractor',
  'restaurant',
  'salon',
  'dentist',
  'lawyer',
  'store',
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Detect whether a place lacks a website — the prime lead signal.
 *
 * @param p - A {@link PlaceRecord} to inspect.
 * @returns `true` when `website` is absent, `null`, or an empty string.
 */
export function detectNoWebsite(p: PlaceRecord): boolean {
  return p.website == null || p.website.trim() === '';
}

/**
 * Determine whether a country code belongs to a priority region (anglophone
 * markets + western Europe).
 *
 * @param countryCode - ISO 3166-1 alpha-2 country code (case-insensitive).
 * @returns `true` when the code maps to a priority market.
 */
export function isPriorityRegion(countryCode?: string | null): boolean {
  if (countryCode == null || countryCode === '') return false;
  const upper = countryCode.toUpperCase();
  return ENGLISH_SPEAKING_PRIORITY.has(upper) || WESTERN_EUROPE_PRIORITY.has(upper);
}

/**
 * Score a lead record on a 0-100 scale.
 *
 * @remarks
 * The returned `leadScore` is clamped to `[0, 100]`.  A score ≥80 indicates a
 * high-value lead that combines the absence of a website with strong
 * geo-targeting and engagement signals.
 *
 * @param p - A {@link PlaceRecord} to score.
 * @returns Object containing `hasWebsite`, the integer `leadScore`, and a
 *   boolean `priority` flag indicating whether the place is in a priority
 *   region.
 *
 * @throws Never — the function is always safe to call.
 */
export function scoreLead(p: PlaceRecord): {
  hasWebsite: boolean;
  leadScore: number;
  priority: boolean;
} {
  const hasWebsite = !detectNoWebsite(p);
  const priority = isPriorityRegion(p.countryCode);

  let score = 0;

  // No website is the primary lead signal
  if (!hasWebsite) {
    score += 45;
  }

  if (p.phone != null && p.phone.trim() !== '') score += 15;
  if ((p.userRatingsTotal ?? 0) > 0) score += 15;
  if (priority) score += 15;

  const typesLower = (p.types ?? []).map((t) => t.toLowerCase());
  const hasServiceType = SERVICE_TYPE_KEYWORDS.some((kw) => typesLower.some((t) => t.includes(kw)));
  if (hasServiceType) score += 10;

  // Intent signal (the differentiator): an active social presence with NO
  // website is proven online-intent, unsolved — the hottest lead. This is what
  // breaks the flat tie among no-contact OSM leads (which otherwise all score
  // ~45-55). A multi-platform presence with no site ranks highest of all.
  const socialCount = p.socials ? Object.keys(p.socials).length : 0;
  if (socialCount > 0) {
    score += 20; // has any social presence
    score += Math.min((socialCount - 1) * 5, 10); // +5 per extra network, capped +10
  }
  if (p.email != null && p.email.trim() !== '') score += 5; // directly reachable

  return {
    hasWebsite,
    leadScore: Math.max(0, Math.min(100, score)),
    priority,
  };
}
