/**
 * @module services/review_synthesis
 * @description Verified review synthesis — feature #24.
 *
 * Fetches a site's Google reviews, **verifies their origin** (only reviews
 * sourced from Google Places with a real author + in-range rating survive),
 * AI-summarizes the verified corpus into one 40-60 word trust paragraph via
 * Workers AI Llama 3.3 70B FP8, selects the top 3 featured verified quotes,
 * computes an aggregate rating, and persists the result to D1.
 *
 * Honesty gate (NON-NEGOTIABLE): we never fabricate reviews and never emit a
 * schema.org `AggregateRating` without real verified data. If zero reviews
 * survive verification, {@link buildReviewJsonLd} returns `null`.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbQueryOne, dbInsert } from './db.js';
import { lookupBusiness, type PlacesResult } from './google_places.js';
import type {
  VerifiedReview,
  ReviewSynthesis,
  ReviewJsonLd,
  ReviewAggregate,
} from '../../libs/features/review_synthesis/feature.schemas.js';

// ─── Constants ───────────────────────────────────────────────────────

/** Workers AI model — FP8-fast variant. NEVER the bare retired alias. */
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_FEATURED = 3;
const SOURCE: VerifiedReview['source'] = 'google_places';

// ─── Types ────────────────────────────────────────────────────────────

interface SiteRow {
  id: string;
  org_id: string | null;
  google_place_id: string | null;
  business_name: string | null;
  business_address: string | null;
}

interface RawReview {
  text: string;
  author: string;
  rating: number;
  time: string;
}

// ─── Verification ─────────────────────────────────────────────────────

/**
 * Filter raw reviews down to verified ones. A review is verified only when:
 *   - it carries non-empty body text
 *   - it carries a non-empty author (anonymous/fabricated rows are rejected)
 *   - its rating is an in-range 1-5 value
 *
 * Every survivor is tagged `{ verified: true, source: 'google_places' }`.
 * Nothing is ever invented — verification is a strict reduction, never an
 * augmentation.
 *
 * @param raw - Reviews as returned by the Places client.
 * @returns Verified, tagged reviews (possibly empty).
 */
export function verifyReviews(raw: RawReview[]): VerifiedReview[] {
  const out: VerifiedReview[] = [];
  for (const r of raw) {
    const text = typeof r.text === 'string' ? r.text.trim() : '';
    const author = typeof r.author === 'string' ? r.author.trim() : '';
    const rating = typeof r.rating === 'number' ? r.rating : NaN;
    if (!text) continue;
    if (!author) continue;
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
    out.push({
      text,
      author,
      rating,
      time: typeof r.time === 'string' ? r.time : '',
      verified: true,
      source: SOURCE,
    });
  }
  return out;
}

/**
 * Compute the aggregate rating from verified reviews only.
 *
 * Prefers the Places-reported aggregate (covers the full review history) when
 * present + sane; otherwise derives from the verified sample. `reviewCount`
 * never under-reports the verified sample we actually hold.
 */
export function computeAggregate(
  verified: VerifiedReview[],
  places: Pick<PlacesResult, 'rating' | 'review_count'> | null,
): ReviewAggregate {
  if (verified.length === 0) {
    return { ratingValue: 0, reviewCount: 0 };
  }
  const sampleAvg =
    verified.reduce((sum, r) => sum + r.rating, 0) / verified.length;

  const placesRating =
    places && typeof places.rating === 'number' && places.rating >= 1 && places.rating <= 5
      ? places.rating
      : null;
  const placesCount =
    places && typeof places.review_count === 'number' && places.review_count >= verified.length
      ? places.review_count
      : null;

  return {
    ratingValue: Math.round((placesRating ?? sampleAvg) * 10) / 10,
    reviewCount: placesCount ?? verified.length,
  };
}

// ─── AI summary ───────────────────────────────────────────────────────

/**
 * Summarize the verified review corpus into a single 40-60 word trust
 * paragraph via Workers AI. Returns an empty string when there is nothing
 * verified to summarize (honesty gate — no synthetic praise).
 */
export async function summarizeReviews(
  env: Env,
  businessName: string,
  verified: VerifiedReview[],
): Promise<string> {
  if (verified.length === 0) return '';

  const corpus = verified
    .map((r) => `- (${r.rating}/5) ${r.author}: ${r.text}`)
    .join('\n');

  const messages = [
    {
      role: 'system',
      content:
        'You write concise, truthful trust paragraphs from real customer reviews. ' +
        'Use ONLY what the reviews actually say. Never invent quotes, names, or claims. ' +
        'Output exactly one paragraph of 40-60 words. No headings, no markdown, no quotes.',
    },
    {
      role: 'user',
      content: `Business: ${businessName}\n\nVerified Google reviews:\n${corpus}\n\nWrite the 40-60 word trust paragraph now.`,
    },
  ];

  const result = (await env.AI.run(
    AI_MODEL as Parameters<typeof env.AI.run>[0],
    { messages, max_tokens: 512 } as Parameters<typeof env.AI.run>[1],
  )) as { response?: string } | string;

  const raw = typeof result === 'string' ? result : (result.response ?? '');
  return raw.trim();
}

// ─── JSON-LD ──────────────────────────────────────────────────────────

/**
 * Build a schema.org `Product` block carrying `AggregateRating` + `Review[]`
 * from a synthesis, using ONLY verified reviews.
 *
 * Returns `null` when there are zero verified reviews — we never emit an
 * `AggregateRating` without real data (Google penalizes fabricated rich
 * snippets; honesty gate forbids it).
 *
 * @param synthesis - A persisted/in-memory synthesis record.
 * @returns A typed JSON-LD object, or `null` when no verified data exists.
 */
export function buildReviewJsonLd(
  synthesis: Pick<ReviewSynthesis, 'featured' | 'aggregate'> & { businessName?: string },
): ReviewJsonLd | null {
  const verified = (synthesis.featured ?? []).filter(
    (r) => r.verified === true && r.source === SOURCE,
  );
  if (verified.length === 0 || synthesis.aggregate.reviewCount <= 0) {
    return null;
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: synthesis.businessName ?? 'Business reviews',
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: synthesis.aggregate.ratingValue,
      reviewCount: synthesis.aggregate.reviewCount,
      bestRating: 5,
      worstRating: 1,
    },
    review: verified.map((r) => ({
      '@type': 'Review' as const,
      author: { '@type': 'Person' as const, name: r.author },
      reviewRating: {
        '@type': 'Rating' as const,
        ratingValue: r.rating,
        bestRating: 5 as const,
        worstRating: 1 as const,
      },
      reviewBody: r.text,
    })),
  };
}

// ─── Orchestration ────────────────────────────────────────────────────

export interface SynthesizeResult {
  ok: boolean;
  error?: string;
  synthesis?: ReviewSynthesis;
  jsonld?: ReviewJsonLd | null;
}

/**
 * Run the full synthesis pipeline for a site and persist the result.
 *
 * Steps: resolve site + place_id → fetch Places business → verify reviews →
 * AI-summarize → select featured → compute aggregate → persist → emit JSON-LD.
 *
 * @param env    - Worker env (DB + AI + GOOGLE_PLACES_API_KEY).
 * @param siteId - Site to synthesize reviews for.
 * @returns Result envelope; `ok: false` with `error` when prerequisites are missing.
 */
export async function synthesizeReviews(env: Env, siteId: string): Promise<SynthesizeResult> {
  const site = await dbQueryOne<SiteRow>(
    env.DB,
    `SELECT id, org_id, google_place_id, business_name, business_address
       FROM sites WHERE id = ? AND deleted_at IS NULL`,
    [siteId],
  );

  if (!site) return { ok: false, error: 'Site not found' };
  if (!site.google_place_id) return { ok: false, error: 'Site has no google_place_id' };

  const businessName = site.business_name ?? 'This business';

  // Fetch the business from Places (verified origin — Google's own API).
  const places = await lookupBusiness(
    env.GOOGLE_PLACES_API_KEY,
    businessName,
    site.business_address ?? '',
  );

  if (!places) {
    return { ok: false, error: 'Google Places lookup returned no result' };
  }

  // Verify origin: only reviews from the Places response, with real authors + ratings.
  const verified = verifyReviews(places.reviews ?? []);
  const featured = verified.slice(0, MAX_FEATURED);
  const aggregate = computeAggregate(verified, places);
  const summary = await summarizeReviews(env, businessName, verified);

  const id = crypto.randomUUID();
  const synthesis: ReviewSynthesis = {
    id,
    siteId,
    orgId: site.org_id,
    summary,
    featured,
    aggregate,
    source: SOURCE,
    aiModel: verified.length > 0 ? AI_MODEL : null,
    createdAt: new Date().toISOString(),
  };

  const { error } = await dbInsert(env.DB, 'review_syntheses', {
    id,
    site_id: siteId,
    org_id: site.org_id,
    summary,
    featured_json: JSON.stringify(featured),
    rating_value: aggregate.ratingValue,
    review_count: aggregate.reviewCount,
    source: SOURCE,
    verified: 1,
    ai_model: synthesis.aiModel,
  });

  if (error) return { ok: false, error };

  const jsonld = buildReviewJsonLd({ ...synthesis, businessName });
  return { ok: true, synthesis, jsonld };
}

/** Row shape persisted in `review_syntheses`. */
interface ReviewSynthesisRow {
  id: string;
  site_id: string;
  org_id: string | null;
  summary: string | null;
  featured_json: string | null;
  rating_value: number | null;
  review_count: number | null;
  source: string | null;
  ai_model: string | null;
  created_at: string;
}

/**
 * Load the latest synthesis for a site (most recent, non-deleted).
 *
 * @param env    - Worker env.
 * @param siteId - Site id.
 * @returns The synthesis record or `null` when none has been computed.
 */
export async function getLatestSynthesis(env: Env, siteId: string): Promise<ReviewSynthesis | null> {
  const row = await dbQueryOne<ReviewSynthesisRow>(
    env.DB,
    `SELECT id, site_id, org_id, summary, featured_json, rating_value, review_count, source, ai_model, created_at
       FROM review_syntheses
      WHERE site_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [siteId],
  );
  if (!row) return null;

  let featured: VerifiedReview[] = [];
  if (row.featured_json) {
    try {
      const parsed = JSON.parse(row.featured_json) as VerifiedReview[];
      featured = Array.isArray(parsed)
        ? parsed.filter((r) => r && r.verified === true && r.source === SOURCE)
        : [];
    } catch {
      featured = [];
    }
  }

  return {
    id: row.id,
    siteId: row.site_id,
    orgId: row.org_id,
    summary: row.summary ?? '',
    featured,
    aggregate: {
      ratingValue: row.rating_value ?? 0,
      reviewCount: row.review_count ?? 0,
    },
    source: SOURCE,
    aiModel: row.ai_model,
    createdAt: row.created_at,
  };
}
