import { searchPlacesByQuery } from '../services/places_search';

/**
 * #9 lead scanner — multi-result Google Places text search (distinct from the
 * existing single-business lookupBusiness). DI'd fetch → unit-provable, never
 * throws (returns [] on no-key / error / non-OK status).
 */
function fetchReturning(body: unknown, ok = true): jest.Mock {
  return jest.fn().mockResolvedValue({ ok, json: async () => body } as Response);
}

const RESULTS = {
  status: 'OK',
  results: [
    {
      place_id: 'p1',
      name: 'Acme Roofing',
      formatted_address: '1 Main St',
      types: ['roofing_contractor'],
      rating: 4.6,
      user_ratings_total: 40,
      business_status: 'OPERATIONAL',
    },
    {
      place_id: 'p2',
      name: 'Bob Plumbing',
      formatted_address: '2 Oak Ave',
      types: ['plumber'],
      rating: 4.1,
      user_ratings_total: 12,
      business_status: 'OPERATIONAL',
    },
  ],
};

describe('searchPlacesByQuery', () => {
  it('returns [] (no fetch) when the api key is missing', async () => {
    const f = fetchReturning(RESULTS);
    expect(await searchPlacesByQuery('', 'roofers newark', f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('maps OK text-search results to lightweight hits', async () => {
    const f = fetchReturning(RESULTS);
    const hits = await searchPlacesByQuery('KEY', 'roofers newark', f);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual(
      expect.objectContaining({
        place_id: 'p1',
        name: 'Acme Roofing',
        formatted_address: '1 Main St',
        reviewCount: 40,
        rating: 4.6,
      }),
    );
    expect(hits[0].types).toEqual(['roofing_contractor']);
    expect(f).toHaveBeenCalledWith(expect.stringContaining('textsearch/json'));
  });

  it('url-encodes the query', async () => {
    const f = fetchReturning(RESULTS);
    await searchPlacesByQuery('KEY', 'roofers in newark, nj', f);
    expect(f.mock.calls[0][0]).toContain(encodeURIComponent('roofers in newark, nj'));
  });

  it('returns [] on a ZERO_RESULTS status', async () => {
    const hits = await searchPlacesByQuery(
      'KEY',
      'x',
      fetchReturning({ status: 'ZERO_RESULTS', results: [] }),
    );
    expect(hits).toEqual([]);
  });

  it('returns [] on a fetch throw (never throws)', async () => {
    const f = jest.fn().mockRejectedValue(new Error('network'));
    expect(await searchPlacesByQuery('KEY', 'x', f)).toEqual([]);
  });

  it('defaults missing optional fields (rating/review_count/types/business_status)', async () => {
    const f = fetchReturning({
      status: 'OK',
      results: [{ place_id: 'p3', name: 'Min', formatted_address: 'addr' }],
    });
    const hits = await searchPlacesByQuery('KEY', 'x', f);
    expect(hits[0]).toEqual({
      place_id: 'p3',
      name: 'Min',
      formatted_address: 'addr',
      types: [],
      rating: null,
      reviewCount: null,
      businessStatus: null,
    });
  });
});
