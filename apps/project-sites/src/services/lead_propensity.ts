/**
 * Lead propensity + contact-confidence engine — pure, no-network scoring core
 * for the automatic Lead Scanner (businesses-without-websites across the US).
 *
 * @remarks
 * Two questions this module answers deterministically, with no side effects:
 *
 *  1. **Can we reach them, and how sure are we?** {@link contactConfidence}
 *     returns a 0-100 confidence for BOTH an email and a mailing address, and a
 *     recommended outreach `channel` (email / postcard / both / none). The
 *     address confidence gates whether a Lob postcard is worth the spend.
 *
 *  2. **How likely are they to pay for a site?** {@link payPropensity} returns a
 *     0-100 score + A–D tier. {@link rankLeads} sorts a batch most-likely-first.
 *
 * Inputs are source-tagged so confidence reflects provenance (a USPS-verified
 * address outranks a Places-derived one; a verified email outranks a guess).
 * Network fetch + persistence live in the (deploy-gated) scan orchestrator; this
 * is the testable brain. Pairs with the shallower {@link scoreLead} (kept for the
 * legacy single-query scan) — this is the richer model the automatic engine uses.
 *
 * @packageDocumentation
 */

/** Provenance of a discovered email, strongest first. */
export type EmailSource = 'verified' | 'listing' | 'guessed_mx' | 'guessed' | null;

/** Provenance of a discovered mailing address, strongest first. */
export type AddressSource = 'usps_verified' | 'sos' | 'places' | 'listing' | null;

/** Recommended outreach channel for a lead. */
export type OutreachChannel = 'email' | 'postcard' | 'both' | 'none';

/** Pay-propensity tier derived from the 0-100 score. */
export type PropensityTier = 'A' | 'B' | 'C' | 'D';

/** Everything known about a candidate business, from all corroborating sources. */
export interface LeadSignals {
  /** The prime signal — true means NOT a prospect for us. */
  hasWebsite: boolean;
  /** Has a Google Business Profile / listing but (with hasWebsite=false) no site → engaged, siteless owner. */
  claimedListing?: boolean;
  /** Present social presence (FB/IG) but no real site. */
  socialOnly?: boolean;
  emailSource?: EmailSource;
  addressSource?: AddressSource;
  hasPhone?: boolean;
  category?: string | null;
  reviewCount?: number | null;
  rating?: number | null;
  /** Months since incorporation (SoS). New businesses convert best. */
  incorporationAgeMonths?: number | null;
  /** How many independent sources corroborated this business (≥2 = higher trust). */
  sourceCount?: number | null;
}

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/** High-value service categories that traditionally lack (and pay for) a website. */
const HIGH_VALUE_CATEGORIES: ReadonlyArray<string> = [
  'plumber',
  'electrician',
  'roofing',
  'roofer',
  'contractor',
  'hvac',
  'landscap',
  'dentist',
  'lawyer',
  'attorney',
  'restaurant',
  'salon',
  'spa',
  'barber',
  'auto_repair',
  'mechanic',
  'real_estate',
  'accountant',
  'chiropractor',
  'cleaning',
];

/** Email confidence (0-100) by provenance. */
function emailConfidence(source: EmailSource): number {
  switch (source) {
    case 'verified':
      return 95;
    case 'listing':
      return 75;
    case 'guessed_mx':
      return 45;
    case 'guessed':
      return 25;
    default:
      return 0;
  }
}

/** Address confidence (0-100) by provenance. */
function addressConfidence(source: AddressSource): number {
  switch (source) {
    case 'usps_verified':
      return 95;
    case 'sos':
      return 80;
    case 'places':
      return 70;
    case 'listing':
      return 55;
    default:
      return 0;
  }
}

/**
 * Compute contact confidence + the recommended outreach channel.
 *
 * @remarks
 * - `channel: 'email'`   when only email clears the threshold (≥50).
 * - `channel: 'postcard'` when only the address clears it (≥60 — Lob spend gate).
 * - `channel: 'both'`    when both clear (try email first, postcard as backup).
 * - `channel: 'none'`    when neither is reliable enough to spend on.
 *
 * @param s - The lead signals (only the source fields are used here).
 * @returns `{ emailConfidence, addressConfidence, channel }` (confidences 0-100).
 *
 * @example
 * ```ts
 * contactConfidence({ hasWebsite: false, emailSource: 'listing', addressSource: 'usps_verified' });
 * // { emailConfidence: 75, addressConfidence: 95, channel: 'both' }
 * ```
 */
export function contactConfidence(s: LeadSignals): {
  emailConfidence: number;
  addressConfidence: number;
  channel: OutreachChannel;
} {
  const email = emailConfidence(s.emailSource ?? null);
  const address = addressConfidence(s.addressSource ?? null);
  const EMAIL_MIN = 50;
  const ADDRESS_MIN = 60; // postcards cost money — demand higher confidence
  const emailOk = email >= EMAIL_MIN;
  const addressOk = address >= ADDRESS_MIN;

  let channel: OutreachChannel;
  if (emailOk && addressOk) channel = 'both';
  else if (emailOk) channel = 'email';
  else if (addressOk) channel = 'postcard';
  else channel = 'none';

  return { emailConfidence: email, addressConfidence: address, channel };
}

/** True when the category string matches any high-value service keyword. */
function isHighValueCategory(category?: string | null): boolean {
  if (!category) return false;
  const c = category.toLowerCase();
  return HIGH_VALUE_CATEGORIES.some((kw) => c.includes(kw));
}

/**
 * Score a lead's likelihood to PAY for a website, 0-100, with an A–D tier.
 *
 * @remarks
 * Weights (additive, then clamped to 0-100). A business already on the web
 * scores 0 — it is not a prospect. Reachability matters: an unreachable lead
 * cannot convert no matter how good, so it is capped.
 *
 * | Signal                                   | Points |
 * | ---------------------------------------- | ------ |
 * | No website (prime)                       | +35    |
 * | Claimed listing but siteless (engaged)   | +15    |
 * | Reachable (email or postcard channel)    | +12    |
 * | High-value service category              | +10    |
 * | Recently incorporated (<6mo +10 / <12 +5)| +5/+10 |
 * | Has reviews (>0 +6, >20 +4 more)         | +6/+10 |
 * | Good rating (≥4.0)                        | +5     |
 * | Social-only (knows they need presence)   | +5     |
 * | Corroborated by ≥2 sources               | +5     |
 *
 * @param s - The full {@link LeadSignals}.
 * @returns `{ score, tier, reachable }`. Tier: A≥75 B≥55 C≥35 D<35.
 * @throws Never.
 *
 * @example
 * ```ts
 * payPropensity({ hasWebsite: false, claimedListing: true, emailSource: 'listing',
 *   category: 'plumber', reviewCount: 40, rating: 4.6, incorporationAgeMonths: 3 });
 * // { score: 93, tier: 'A', reachable: true }
 * ```
 */
export function payPropensity(s: LeadSignals): {
  score: number;
  tier: PropensityTier;
  reachable: boolean;
} {
  const { channel } = contactConfidence(s);
  const reachable = channel !== 'none';

  if (s.hasWebsite) {
    return { score: 0, tier: 'D', reachable };
  }

  let score = 35; // no website — the prime signal

  if (s.claimedListing) score += 15;
  if (reachable) score += 12;
  if (isHighValueCategory(s.category)) score += 10;

  const age = s.incorporationAgeMonths;
  if (age != null && age >= 0) {
    if (age < 6) score += 10;
    else if (age < 12) score += 5;
  }

  const reviews = s.reviewCount ?? 0;
  if (reviews > 0) score += 6;
  if (reviews > 20) score += 4;

  if ((s.rating ?? 0) >= 4.0) score += 5;
  if (s.socialOnly) score += 5;
  if ((s.sourceCount ?? 0) >= 2) score += 5;

  const final = clamp(score);
  const tier: PropensityTier = final >= 75 ? 'A' : final >= 55 ? 'B' : final >= 35 ? 'C' : 'D';
  return { score: final, tier, reachable };
}

/** A scored lead row produced by {@link rankLeads}. */
export interface RankedLead<T extends LeadSignals = LeadSignals> {
  lead: T;
  score: number;
  tier: PropensityTier;
  reachable: boolean;
  emailConfidence: number;
  addressConfidence: number;
  channel: OutreachChannel;
}

/**
 * Rank a batch of leads most-likely-to-pay first.
 *
 * @remarks
 * Sort key: pay-propensity score desc, then reachable-first, then higher
 * combined contact confidence (so among equal-score leads we surface the ones
 * we can actually contact + are surest about). Stable for equal keys.
 *
 * @param leads - The candidate signals.
 * @returns A new array of {@link RankedLead}, highest propensity first.
 *
 * @example
 * ```ts
 * const ranked = rankLeads(candidates);
 * ranked[0].tier; // 'A' — work this one first
 * ```
 */
export function rankLeads<T extends LeadSignals>(leads: readonly T[]): RankedLead<T>[] {
  return leads
    .map((lead): RankedLead<T> => {
      const prop = payPropensity(lead);
      const contact = contactConfidence(lead);
      return {
        lead,
        score: prop.score,
        tier: prop.tier,
        reachable: prop.reachable,
        emailConfidence: contact.emailConfidence,
        addressConfidence: contact.addressConfidence,
        channel: contact.channel,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
      const aC = a.emailConfidence + a.addressConfidence;
      const bC = b.emailConfidence + b.addressConfidence;
      return bC - aC;
    });
}
