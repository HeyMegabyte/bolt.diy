/**
 * @module libs/features/local_seo_suite/service
 *
 * Local SEO Power Suite (#43, ROI 2.29) — pure NAP consistency checker,
 * review response suggester, and citation audit engine. Zero I/O.
 *
 * NAP = Name, Address, Phone — the three fields that must be identical
 * across all directories for local SEO ranking.
 */
export interface NapRecord {
  source: string;
  name: string;
  address: string;
  phone: string;
  url?: string;
}

export interface NapDiscrepancy {
  source: string;
  field: 'name' | 'address' | 'phone' | 'url';
  expected: string;
  found: string;
  severity: 'critical' | 'warning';
}

export interface ReviewSuggestion {
  reviewText: string;
  rating: number;
  reviewerName: string;
  platform: string;
  suggestedReply: string;
  tone: 'grateful' | 'apologetic' | 'neutral' | 'promotional';
  keyPoints: string[];
}

export interface LocalSeoAudit {
  siteId: string;
  generatedAt: string;
  napDiscrepancies: NapDiscrepancy[];
  discrepancyCount: number;
  reviewSuggestions: ReviewSuggestion[];
  directoryCoverage: { total: number; claimed: number; unclaimed: number };
  summary: string;
}

// ── NAP consistency ─────────────────────────────────────────────────────────

const NORMALIZE_RE = /[^\w\s]|suite\s*\d+|ste\.?\s*\d+|unit\s*\d+|#\s*\d+/gi;

function normalize(s: string): string {
  return s.toLowerCase().replace(NORMALIZE_RE, '').replace(/\s+/g, ' ').trim();
}

/**
 * Audits NAP consistency across directory sources.
 * Each source's Name/Address/Phone is compared against the canonical record.
 */
export function auditNapConsistency(
  canonical: NapRecord,
  sources: NapRecord[],
): NapDiscrepancy[] {
  const discrepancies: NapDiscrepancy[] = [];
  const canonNorm = {
    name: normalize(canonical.name),
    address: normalize(canonical.address),
    phone: canonical.phone.replace(/\D/g, ''),
    url: canonical.url?.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };

  for (const source of sources) {
    const srcNorm = {
      name: normalize(source.name),
      address: normalize(source.address),
      phone: source.phone.replace(/\D/g, ''),
      url: source.url?.toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, ''),
    };

    for (const field of ['name', 'address', 'phone', 'url'] as const) {
      const expected = canonNorm[field];
      const found = srcNorm[field];
      if (expected && found && expected !== found) {
        discrepancies.push({
          source: source.source,
          field,
          expected: canonical[field] || '',
          found: source[field] || '',
          severity: field === 'name' || field === 'phone' ? 'critical' : 'warning',
        });
      }
    }
  }

  return discrepancies;
}

// ── Review response suggestions ─────────────────────────────────────────────

const REPLY_TEMPLATES: Array<{
  condition: (r: { rating: number; text: string }) => boolean;
  template: (r: { reviewerName: string; rating: number; platform: string }) => ReviewSuggestion;
}> = [
  {
    condition: (r) => r.rating >= 5,
    template: (r) => ({
      reviewText: '',
      rating: r.rating,
      reviewerName: r.reviewerName,
      platform: r.platform,
      suggestedReply: `Thank you so much, ${r.reviewerName}! We are thrilled you had a great experience. Reviews like yours make our day. We look forward to serving you again soon!`,
      tone: 'grateful',
      keyPoints: ['Thank them personally', 'Acknowledge the positive experience', 'Invite them back'],
    }),
  },
  {
    condition: (r) => r.rating === 4,
    template: (r) => ({
      reviewText: '',
      rating: r.rating,
      reviewerName: r.reviewerName,
      platform: r.platform,
      suggestedReply: `Thank you for your review, ${r.reviewerName}! We appreciate your feedback and are glad you had a good experience. If there is anything we can do to earn that fifth star next time, please let us know!`,
      tone: 'grateful',
      keyPoints: ['Thank them', 'Acknowledge 4-star is still positive', 'Ask what would make it 5 stars'],
    }),
  },
  {
    condition: (r) => r.rating <= 3 && r.rating >= 2,
    template: (r) => ({
      reviewText: '',
      rating: r.rating,
      reviewerName: r.reviewerName,
      platform: r.platform,
      suggestedReply: `Thank you for your honest feedback, ${r.reviewerName}. We are sorry your experience did not meet expectations. We would love the opportunity to make things right — please contact us directly so we can address your concerns personally.`,
      tone: 'apologetic',
      keyPoints: ['Acknowledge their concerns', 'Apologize sincerely', 'Offer direct contact for resolution', 'Do NOT be defensive'],
    }),
  },
  {
    condition: (r) => r.rating === 1,
    template: (r) => ({
      reviewText: '',
      rating: r.rating,
      reviewerName: r.reviewerName,
      platform: r.platform,
      suggestedReply: `${r.reviewerName}, we are truly sorry to hear about your experience. This is not the standard we hold ourselves to. We take your feedback seriously and would like to personally address this. Please reach out to us directly — we want to make this right.`,
      tone: 'apologetic',
      keyPoints: ['Apologize unreservedly', 'Take responsibility', 'Offer direct personal contact', 'Promise to investigate', 'Never argue in public'],
    }),
  },
];

/**
 * Generates suggested review replies based on star rating and sentiment.
 */
export function suggestReplies(
  reviews: Array<{ text: string; rating: number; reviewerName: string; platform: string }>,
): ReviewSuggestion[] {
  return reviews.map((review) => {
    const match = REPLY_TEMPLATES.find((t) => t.condition(review));
    if (match) {
      const suggestion = match.template(review);
      return { ...suggestion, reviewText: review.text };
    }
    return {
      reviewText: review.text,
      rating: review.rating,
      reviewerName: review.reviewerName,
      platform: review.platform,
      suggestedReply: `Thank you for your feedback, ${review.reviewerName}. We appreciate you taking the time to share your experience.`,
      tone: 'neutral',
      keyPoints: ['Thank them', 'Acknowledge their time'],
    };
  });
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Runs a complete local SEO audit: NAP consistency + review response suggestions.
 */
export function runLocalSeoAudit(
  siteId: string,
  canonical: NapRecord,
  directorySources: NapRecord[],
  reviews: Array<{ text: string; rating: number; reviewerName: string; platform: string }>,
): LocalSeoAudit {
  const napDiscrepancies = auditNapConsistency(canonical, directorySources);
  const reviewSuggestions = suggestReplies(reviews);
  const claimed = directorySources.filter((s) => s.name && s.phone).length;

  const summary = napDiscrepancies.length === 0
    ? 'NAP data is consistent across all directories. Your local SEO foundation is solid.'
    : `${napDiscrepancies.length} NAP discrepancy(s) found across ${directorySources.length} directories. Fix these to improve local search rankings.`;

  return {
    siteId,
    generatedAt: new Date().toISOString(),
    napDiscrepancies,
    discrepancyCount: napDiscrepancies.length,
    reviewSuggestions,
    directoryCoverage: { total: directorySources.length, claimed, unclaimed: directorySources.length - claimed },
    summary,
  };
}
