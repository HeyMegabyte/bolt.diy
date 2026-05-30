/**
 * Unit tests for Verified Review Synthesis.
 * Covers: aggregate math, JSON-LD (incl. null on zero reviews), deterministic
 * fallback summary, Places fetch (no-key/no-place → [], success mapping), and
 * synthesizeReviews (real-reviews path + the no-fabrication empty path).
 */

import {
  computeAggregate,
  buildReviewJsonLd,
  fallbackSummary,
  fetchVerifiedReviews,
  synthesizeReviews,
} from '../service.js';
import { ReviewJsonLdSchema, type VerifiedReview } from '../feature.schemas.js';
import type { Env } from '../../../../src/types/env.js';

const review = (rating: number, author: string, text: string): VerifiedReview => ({
  rating,
  author,
  text,
  time: '2026-01-01T00:00:00Z',
  verified: true,
  source: 'google_places',
});

describe('review_synthesis pure cores', () => {
  it('computeAggregate: empty → 0/0, else 1-dp mean + count', () => {
    expect(computeAggregate([])).toEqual({ ratingValue: 0, reviewCount: 0 });
    expect(
      computeAggregate([review(5, 'a', 'x'), review(4, 'b', 'y'), review(4, 'c', 'z')]),
    ).toEqual({ ratingValue: 4.3, reviewCount: 3 });
  });

  it('buildReviewJsonLd: null when no reviews (never a hollow AggregateRating)', () => {
    expect(buildReviewJsonLd('Biz', [], { ratingValue: 0, reviewCount: 0 })).toBeNull();
  });

  it('buildReviewJsonLd: valid schema.org Product with ≤3 embedded reviews', () => {
    const reviews = [
      review(5, 'Ada', 'Great'),
      review(4, 'Bo', 'Good'),
      review(5, 'Cy', 'Nice'),
      review(3, 'Di', 'Ok'),
    ];
    const agg = computeAggregate(reviews);
    const ld = buildReviewJsonLd('Biz', reviews, agg);
    expect(ld).not.toBeNull();
    expect(() => ReviewJsonLdSchema.parse(ld)).not.toThrow();
    expect(ld!.review).toHaveLength(3); // embeds at most 3
    expect(ld!.aggregateRating.reviewCount).toBe(4);
  });

  it('fallbackSummary: empty → "", else a factual sentence', () => {
    expect(fallbackSummary('Biz', { ratingValue: 0, reviewCount: 0 })).toBe('');
    expect(fallbackSummary("Vito's", { ratingValue: 4.8, reviewCount: 12 })).toContain(
      '4.8-star rating across 12 verified Google reviews',
    );
  });
});

describe('fetchVerifiedReviews', () => {
  it('returns [] with no placeId or no key', async () => {
    expect(await fetchVerifiedReviews({} as Env, null)).toEqual([]);
    expect(await fetchVerifiedReviews({ GOOGLE_API_KEY: 'k' } as unknown as Env, null)).toEqual([]);
    expect(await fetchVerifiedReviews({} as Env, 'place1')).toEqual([]);
  });

  it('maps Google Places reviews to verified reviews', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = (async () => ({
      ok: true,
      json: async () => ({
        result: {
          reviews: [{ author_name: 'Ada', rating: 5, text: 'Loved it', time: 1700000000 }],
        },
      }),
    })) as unknown as typeof fetch;
    const out = await fetchVerifiedReviews({ GOOGLE_API_KEY: 'k' } as unknown as Env, 'place1');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      author: 'Ada',
      rating: 5,
      verified: true,
      source: 'google_places',
    });
  });
});

/** Mock D1 that records the review_syntheses insert. */
function db() {
  const inserts: unknown[] = [];
  const env = {
    GOOGLE_API_KEY: 'k', // so fetchVerifiedReviews reaches the (mocked) Places fetch
    DB: {
      prepare: (sql: string) => ({
        bind: (...p: unknown[]) => ({
          run: async () => {
            if (sql.includes('INSERT OR REPLACE INTO review_syntheses')) inserts.push(p);
            return { meta: { changes: 1 } };
          },
          all: async () => ({ results: [] }),
        }),
      }),
    },
  } as unknown as Env;
  return { env, inserts };
}

describe('synthesizeReviews', () => {
  it('synthesizes real reviews (fallback summary, no AI) and persists', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = (async () => ({
      ok: true,
      json: async () => ({
        result: {
          reviews: [
            { author_name: 'Ada', rating: 5, text: 'Excellent service', time: 1700000000 },
            { author_name: 'Bo', rating: 4, text: 'Solid', time: 1700000001 },
          ],
        },
      }),
    })) as unknown as typeof fetch;
    const { env, inserts } = db(); // no env.AI → deterministic fallback summary
    const s = await synthesizeReviews(env, {
      siteId: 'site1',
      orgId: 'org1',
      businessName: 'Vitos',
      placeId: 'p1',
    });
    expect(s.aggregate).toEqual({ ratingValue: 4.5, reviewCount: 2 });
    expect(s.featured[0].rating).toBe(5); // sorted desc
    expect(s.summary).toContain('4.5-star rating across 2');
    expect(inserts).toHaveLength(1);
  });

  it('no-fabrication: zero verified reviews → empty synthesis, no JSON-LD', async () => {
    const { env } = db();
    const s = await synthesizeReviews(env, {
      siteId: 'site1',
      orgId: 'org1',
      businessName: 'Vitos',
      placeId: null,
    });
    expect(s.aggregate).toEqual({ ratingValue: 0, reviewCount: 0 });
    expect(s.summary).toBe('');
    expect(s.featured).toEqual([]);
    expect(buildReviewJsonLd('Vitos', s.featured, s.aggregate)).toBeNull();
  });
});
