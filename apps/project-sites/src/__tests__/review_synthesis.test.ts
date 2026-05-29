/**
 * Unit tests for the Verified Review Synthesis feature (idea #24).
 *
 * Covers:
 *   - verified-only filtering (fabricated / empty-author / out-of-range rejected)
 *   - JSON-LD has correct @type AggregateRating + ratingValue
 *   - null JSON-LD when zero verified reviews (honesty gate)
 *   - AI summary called with the fp8-fast alias
 *   - end-to-end synthesizeReviews persistence
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/google_places.js', () => ({
  lookupBusiness: jest.fn(),
}));

import { dbQueryOne, dbInsert } from '../services/db.js';
import { lookupBusiness } from '../services/google_places.js';
import {
  verifyReviews,
  computeAggregate,
  summarizeReviews,
  buildReviewJsonLd,
  synthesizeReviews,
  getLatestSynthesis,
} from '../services/review_synthesis.js';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockLookup = lookupBusiness as jest.MockedFunction<typeof lookupBusiness>;

const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function makeEnv(aiResponse = 'A reliable trust paragraph from real reviews.') {
  const aiRun = jest.fn().mockResolvedValue({ response: aiResponse });
  return {
    env: {
      DB: {} as D1Database,
      AI: { run: aiRun },
      GOOGLE_PLACES_API_KEY: 'test-key',
    } as any,
    aiRun,
  };
}

const GOOD_REVIEW = { text: 'Great service, friendly staff.', author: 'Jane D.', rating: 5, time: '2 weeks ago' };
const FABRICATED_EMPTY_AUTHOR = { text: 'Amazing!', author: '', rating: 5, time: '1 day ago' };
const EMPTY_TEXT = { text: '   ', author: 'Bob', rating: 4, time: 'a month ago' };
const OUT_OF_RANGE = { text: 'Decent', author: 'Carol', rating: 9, time: 'a year ago' };

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// verifyReviews
// ---------------------------------------------------------------------------
describe('verifyReviews', () => {
  it('keeps only valid reviews and tags them verified/google_places', () => {
    const verified = verifyReviews([GOOD_REVIEW, FABRICATED_EMPTY_AUTHOR, EMPTY_TEXT, OUT_OF_RANGE]);
    expect(verified).toHaveLength(1);
    expect(verified[0]).toEqual({
      text: 'Great service, friendly staff.',
      author: 'Jane D.',
      rating: 5,
      time: '2 weeks ago',
      verified: true,
      source: 'google_places',
    });
  });

  it('excludes a fabricated empty-author review', () => {
    const verified = verifyReviews([FABRICATED_EMPTY_AUTHOR]);
    expect(verified).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(verifyReviews([])).toEqual([]);
  });

  it('trims author/text and rejects whitespace-only', () => {
    const verified = verifyReviews([{ text: '  ok  ', author: '  Sam  ', rating: 3, time: 'now' }]);
    expect(verified).toHaveLength(1);
    expect(verified[0].author).toBe('Sam');
    expect(verified[0].text).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// computeAggregate
// ---------------------------------------------------------------------------
describe('computeAggregate', () => {
  it('prefers Places-reported rating + count when sane', () => {
    const verified = verifyReviews([GOOD_REVIEW, { ...GOOD_REVIEW, author: 'Tom', rating: 3 }]);
    const agg = computeAggregate(verified, { rating: 4.6, review_count: 120 });
    expect(agg).toEqual({ ratingValue: 4.6, reviewCount: 120 });
  });

  it('falls back to verified sample when Places aggregate missing', () => {
    const verified = verifyReviews([GOOD_REVIEW, { ...GOOD_REVIEW, author: 'Tom', rating: 3 }]);
    const agg = computeAggregate(verified, null);
    expect(agg.ratingValue).toBe(4); // (5+3)/2
    expect(agg.reviewCount).toBe(2);
  });

  it('returns zeros when no verified reviews', () => {
    expect(computeAggregate([], { rating: 5, review_count: 99 })).toEqual({ ratingValue: 0, reviewCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// summarizeReviews
// ---------------------------------------------------------------------------
describe('summarizeReviews', () => {
  it('calls Workers AI with the fp8-fast alias', async () => {
    const { env, aiRun } = makeEnv();
    const verified = verifyReviews([GOOD_REVIEW]);
    const summary = await summarizeReviews(env, 'Acme Co', verified);

    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(aiRun.mock.calls[0][0]).toBe(AI_MODEL);
    expect(aiRun.mock.calls[0][1]).toEqual(expect.objectContaining({ max_tokens: 512 }));
    expect(summary).toBe('A reliable trust paragraph from real reviews.');
  });

  it('returns empty string and skips AI when no verified reviews', async () => {
    const { env, aiRun } = makeEnv();
    const summary = await summarizeReviews(env, 'Acme Co', []);
    expect(summary).toBe('');
    expect(aiRun).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildReviewJsonLd
// ---------------------------------------------------------------------------
describe('buildReviewJsonLd', () => {
  it('emits AggregateRating + Review[] with correct @type and ratingValue', () => {
    const verified = verifyReviews([GOOD_REVIEW]);
    const jsonld = buildReviewJsonLd({
      featured: verified,
      aggregate: { ratingValue: 4.6, reviewCount: 120 },
      businessName: 'Acme Co',
    });

    expect(jsonld).not.toBeNull();
    expect(jsonld!['@type']).toBe('Product');
    expect(jsonld!.name).toBe('Acme Co');
    expect(jsonld!.aggregateRating['@type']).toBe('AggregateRating');
    expect(jsonld!.aggregateRating.ratingValue).toBe(4.6);
    expect(jsonld!.aggregateRating.reviewCount).toBe(120);
    expect(jsonld!.review).toHaveLength(1);
    expect(jsonld!.review[0]['@type']).toBe('Review');
    expect(jsonld!.review[0].author).toEqual({ '@type': 'Person', name: 'Jane D.' });
    expect(jsonld!.review[0].reviewRating.ratingValue).toBe(5);
  });

  it('returns null when zero verified reviews (honesty gate)', () => {
    const jsonld = buildReviewJsonLd({ featured: [], aggregate: { ratingValue: 0, reviewCount: 0 } });
    expect(jsonld).toBeNull();
  });

  it('returns null when reviewCount is zero even if featured present', () => {
    const verified = verifyReviews([GOOD_REVIEW]);
    const jsonld = buildReviewJsonLd({ featured: verified, aggregate: { ratingValue: 5, reviewCount: 0 } });
    expect(jsonld).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// synthesizeReviews (orchestration)
// ---------------------------------------------------------------------------
describe('synthesizeReviews', () => {
  it('fails when site not found', async () => {
    const { env } = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null);
    const result = await synthesizeReviews(env, 'site_x');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  it('fails when site has no google_place_id', async () => {
    const { env } = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'site_1',
      org_id: 'org_1',
      google_place_id: null,
      business_name: 'Acme',
      business_address: '1 St',
    });
    const result = await synthesizeReviews(env, 'site_1');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/google_place_id/);
  });

  it('synthesizes verified reviews, persists, and emits JSON-LD', async () => {
    const { env, aiRun } = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'site_1',
      org_id: 'org_1',
      google_place_id: 'place_abc',
      business_name: 'Acme Co',
      business_address: '1 Main St',
    });
    mockLookup.mockResolvedValueOnce({
      place_id: 'place_abc',
      name: 'Acme Co',
      formatted_address: '1 Main St',
      phone: null,
      website: null,
      rating: 4.5,
      review_count: 200,
      hours: null,
      geo: null,
      maps_url: null,
      photos: [],
      types: [],
      price_level: null,
      reviews: [GOOD_REVIEW, FABRICATED_EMPTY_AUTHOR, OUT_OF_RANGE],
      business_status: null,
    } as any);

    const result = await synthesizeReviews(env, 'site_1');

    expect(result.ok).toBe(true);
    // Only 1 of 3 reviews verified
    expect(result.synthesis!.featured).toHaveLength(1);
    expect(result.synthesis!.featured[0].verified).toBe(true);
    expect(result.synthesis!.aggregate).toEqual({ ratingValue: 4.5, reviewCount: 200 });
    expect(result.synthesis!.aiModel).toBe(AI_MODEL);
    expect(aiRun.mock.calls[0][0]).toBe(AI_MODEL);

    // Persisted with verified=1 + source
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      env.DB,
      'review_syntheses',
      expect.objectContaining({ site_id: 'site_1', source: 'google_places', verified: 1, ai_model: AI_MODEL }),
    );

    // JSON-LD present + correct
    expect(result.jsonld).not.toBeNull();
    expect(result.jsonld!.aggregateRating['@type']).toBe('AggregateRating');
    expect(result.jsonld!.review).toHaveLength(1);
  });

  it('persists empty synthesis + null JSON-LD when Places returns no usable reviews', async () => {
    const { env, aiRun } = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'site_2',
      org_id: 'org_2',
      google_place_id: 'place_def',
      business_name: 'New Biz',
      business_address: '2 Side St',
    });
    mockLookup.mockResolvedValueOnce({
      place_id: 'place_def',
      name: 'New Biz',
      formatted_address: '2 Side St',
      phone: null,
      website: null,
      rating: null,
      review_count: null,
      hours: null,
      geo: null,
      maps_url: null,
      photos: [],
      types: [],
      price_level: null,
      reviews: [FABRICATED_EMPTY_AUTHOR, OUT_OF_RANGE],
      business_status: null,
    } as any);

    const result = await synthesizeReviews(env, 'site_2');

    expect(result.ok).toBe(true);
    expect(result.synthesis!.featured).toHaveLength(0);
    expect(result.synthesis!.aggregate).toEqual({ ratingValue: 0, reviewCount: 0 });
    expect(result.synthesis!.aiModel).toBeNull();
    expect(aiRun).not.toHaveBeenCalled();
    expect(result.jsonld).toBeNull();
  });

  it('fails when Places lookup returns null', async () => {
    const { env } = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'site_3',
      org_id: 'org_3',
      google_place_id: 'place_ghi',
      business_name: 'Ghost',
      business_address: '3 Nowhere',
    });
    mockLookup.mockResolvedValueOnce(null);
    const result = await synthesizeReviews(env, 'site_3');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Places/);
  });
});

// ---------------------------------------------------------------------------
// getLatestSynthesis
// ---------------------------------------------------------------------------
describe('getLatestSynthesis', () => {
  it('returns null when no row', async () => {
    const { env } = makeEnv();
    mockQueryOne.mockResolvedValueOnce(null);
    expect(await getLatestSynthesis(env, 'site_1')).toBeNull();
  });

  it('parses featured_json + filters non-verified entries', async () => {
    const { env } = makeEnv();
    mockQueryOne.mockResolvedValueOnce({
      id: 'rs_1',
      site_id: 'site_1',
      org_id: 'org_1',
      summary: 'Trusted by locals.',
      featured_json: JSON.stringify([
        { text: 'Good', author: 'A', rating: 5, time: 'now', verified: true, source: 'google_places' },
        { text: 'Fake', author: 'B', rating: 5, time: 'now', verified: false, source: 'manual' },
      ]),
      rating_value: 4.7,
      review_count: 50,
      source: 'google_places',
      ai_model: AI_MODEL,
      created_at: '2026-05-28T00:00:00Z',
    } as any);

    const synthesis = await getLatestSynthesis(env, 'site_1');
    expect(synthesis).not.toBeNull();
    expect(synthesis!.featured).toHaveLength(1);
    expect(synthesis!.aggregate).toEqual({ ratingValue: 4.7, reviewCount: 50 });
  });
});
