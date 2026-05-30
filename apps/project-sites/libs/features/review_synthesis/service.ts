/**
 * @module libs/features/review_synthesis/service
 * @description Verified Review Synthesis — turns a site's REAL Google reviews
 * into a trust paragraph + AggregateRating/Review JSON-LD for rich snippets.
 *
 * **No fabrication (hard rule):** reviews are fetched server-side from Google
 * Places only (`verified: true, source: 'google_places'`) — never from the
 * request body. With zero verified reviews: empty summary, 0/0 aggregate, and
 * NO JSON-LD (we never emit an AggregateRating we can't back with real reviews).
 *
 * The aggregate + JSON-LD are deterministic + pure (fully tested); the trust
 * paragraph is best-effort Workers AI with a deterministic factual fallback.
 *
 * @packageDocumentation
 */

import type { Env } from '../../../src/types/env.js';
import { dbQuery, dbExecute } from '../../../src/services/db.js';
import {
  VerifiedReviewSchema,
  ReviewSynthesisSchema,
  type VerifiedReview,
  type ReviewAggregate,
  type ReviewJsonLd,
  type ReviewSynthesis,
} from './feature.schemas.js';

/** Flag key gating this feature. */
export const FLAG_KEY = 'review_synthesis';

/** Workers AI model for the trust-paragraph summary (FP8, free, fast). */
const SUMMARY_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Round a number to one decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Compute the aggregate rating from verified reviews. Empty → `{0, 0}`.
 * @param reviews - Verified reviews.
 * @returns `{ ratingValue (1dp mean), reviewCount }`.
 */
export function computeAggregate(reviews: VerifiedReview[]): ReviewAggregate {
  if (reviews.length === 0) return { ratingValue: 0, reviewCount: 0 };
  const mean = reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length;
  return { ratingValue: round1(mean), reviewCount: reviews.length };
}

/**
 * Build schema.org Product + AggregateRating + Review JSON-LD, or `null` when
 * there are no verified reviews (we never emit a hollow AggregateRating).
 * @param businessName - The site's business name.
 * @param reviews      - Verified reviews (top 3 are embedded as Review nodes).
 * @param aggregate    - Pre-computed aggregate.
 */
export function buildReviewJsonLd(
  businessName: string,
  reviews: VerifiedReview[],
  aggregate: ReviewAggregate,
): ReviewJsonLd | null {
  if (aggregate.reviewCount === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: businessName,
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: aggregate.ratingValue,
      reviewCount: aggregate.reviewCount,
      bestRating: 5,
      worstRating: 1,
    },
    review: reviews.slice(0, 3).map((r) => ({
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

/** Deterministic, factual fallback paragraph (used when AI is unavailable). */
export function fallbackSummary(businessName: string, aggregate: ReviewAggregate): string {
  if (aggregate.reviewCount === 0) return '';
  return `${businessName} holds a ${aggregate.ratingValue}-star rating across ${aggregate.reviewCount} verified Google review${aggregate.reviewCount === 1 ? '' : 's'}.`;
}

/** Best-effort AI trust paragraph; falls back to {@link fallbackSummary}. */
async function aiSummary(
  env: Env,
  businessName: string,
  reviews: VerifiedReview[],
  aggregate: ReviewAggregate,
): Promise<{ summary: string; model: string | null }> {
  if (aggregate.reviewCount === 0) return { summary: '', model: null };
  const fallback = fallbackSummary(businessName, aggregate);
  try {
    const ai = (
      env as unknown as { AI?: { run: (m: string, o: unknown) => Promise<{ response?: string }> } }
    ).AI;
    if (!ai) return { summary: fallback, model: null };
    const corpus = reviews
      .slice(0, 8)
      .map((r) => `(${r.rating}★) ${r.text}`)
      .join('\n');
    const out = await ai.run(SUMMARY_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'Write a single 40-60 word trust paragraph summarizing these REAL customer reviews. Only use what the reviews say — never invent facts, numbers, or claims. Warm, specific, no marketing fluff.',
        },
        {
          role: 'user',
          content: `Business: ${businessName}\nAggregate: ${aggregate.ratingValue}★ over ${aggregate.reviewCount} reviews\nReviews:\n${corpus}`,
        },
      ],
    });
    const text = (out?.response ?? '').trim();
    return text ? { summary: text, model: SUMMARY_MODEL } : { summary: fallback, model: null };
  } catch {
    return { summary: fallback, model: null };
  }
}

/**
 * Fetch verified reviews from Google Places Details. Degrades to `[]` on any
 * failure / missing key / no place id — the ONLY review source (verified).
 * @param env     - Worker env (uses `GOOGLE_API_KEY`).
 * @param placeId - The site's `google_place_id`, or null.
 */
export async function fetchVerifiedReviews(
  env: Env,
  placeId: string | null,
): Promise<VerifiedReview[]> {
  const key = (env as unknown as { GOOGLE_API_KEY?: string }).GOOGLE_API_KEY;
  if (!placeId || !key) return [];
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=reviews&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      result?: {
        reviews?: Array<{ author_name?: string; rating?: number; text?: string; time?: number }>;
      };
    };
    const raw = json.result?.reviews ?? [];
    const mapped: VerifiedReview[] = [];
    for (const r of raw) {
      const parsed = VerifiedReviewSchema.safeParse({
        text: r.text ?? '',
        author: r.author_name ?? '',
        rating: r.rating ?? 0,
        time: r.time ? new Date(r.time * 1000).toISOString() : new Date(0).toISOString(),
        verified: true,
        source: 'google_places',
      });
      if (parsed.success) mapped.push(parsed.data);
    }
    return mapped;
  } catch {
    return [];
  }
}

/**
 * Synthesize a site's verified reviews and persist the result.
 *
 * @remarks Reviews come ONLY from {@link fetchVerifiedReviews} — never the
 * caller. No verified reviews → an empty (but valid) synthesis is stored.
 * @returns The persisted {@link ReviewSynthesis}.
 */
export async function synthesizeReviews(
  env: Env,
  input: { siteId: string; orgId: string | null; businessName: string; placeId: string | null },
): Promise<ReviewSynthesis> {
  const reviews = await fetchVerifiedReviews(env, input.placeId);
  const aggregate = computeAggregate(reviews);
  const featured = [...reviews].sort((a, b) => b.rating - a.rating).slice(0, 3);
  const { summary, model } = await aiSummary(env, input.businessName, reviews, aggregate);
  const id = crypto.randomUUID();

  await dbExecute(
    env.DB,
    `INSERT OR REPLACE INTO review_syntheses
       (id, site_id, org_id, summary, featured_json, rating_value, review_count, ai_model, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'google_places', datetime('now'))`,
    [
      id,
      input.siteId,
      input.orgId,
      summary,
      JSON.stringify(featured),
      aggregate.ratingValue,
      aggregate.reviewCount,
      model,
    ],
  ).catch(() => undefined);

  return ReviewSynthesisSchema.parse({
    id,
    siteId: input.siteId,
    orgId: input.orgId,
    summary,
    featured,
    aggregate,
    source: 'google_places',
    aiModel: model,
    createdAt: new Date().toISOString(),
  });
}

interface SynthRow {
  id: string;
  site_id: string;
  org_id: string | null;
  summary: string | null;
  featured_json: string | null;
  rating_value: number | null;
  review_count: number | null;
  ai_model: string | null;
  created_at: string;
}

/** Read a site's stored synthesis (most recent), or null. */
export async function getSynthesis(env: Env, siteId: string): Promise<ReviewSynthesis | null> {
  const { data } = await dbQuery<SynthRow>(
    env.DB,
    `SELECT * FROM review_syntheses WHERE site_id = ? ORDER BY created_at DESC LIMIT 1`,
    [siteId],
  );
  const row = data[0];
  if (!row) return null;
  let featured: VerifiedReview[] = [];
  try {
    const arr = JSON.parse(row.featured_json ?? '[]') as unknown;
    if (Array.isArray(arr))
      featured = arr.filter((r) => VerifiedReviewSchema.safeParse(r).success) as VerifiedReview[];
  } catch {
    /* malformed → empty */
  }
  return ReviewSynthesisSchema.parse({
    id: row.id,
    siteId: row.site_id,
    orgId: row.org_id,
    summary: row.summary ?? '',
    featured,
    aggregate: { ratingValue: row.rating_value ?? 0, reviewCount: row.review_count ?? 0 },
    source: 'google_places',
    aiModel: row.ai_model,
    createdAt: row.created_at,
  });
}
