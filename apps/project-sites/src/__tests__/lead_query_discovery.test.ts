/**
 * lead_query_discovery — OSM Overpass discovery robustness (the FREE lead-scan engine).
 *
 * Regression (AL-036 follow-on, 2026-09-05): a fresh `/scan` returned `scanned:0`
 * even for a dense metro. Root cause: `fetchOverpass` accepted the FIRST HTTP-200
 * response even when it carried 0 elements. A regional mirror (overpass.osm.ch) 200s
 * with an EMPTY body for a US bbox, so when the earlier mirrors 504'd the chain
 * short-circuited on that false-empty and never reached a mirror that HAS the data →
 * a lying "0 businesses found". The fix: a 200-with-0-elements no longer wins — the
 * chain keeps trying until a mirror returns data (or every mirror authoritatively
 * says empty). These tests pin that behavior via the injectable `fetchImpl` seam.
 */
import { discoverLeadsForQuery } from '../services/lead_query_discovery';

/** Nominatim bbox for "Newark NJ" — [south, north, west, east] per the API. */
const NEWARK_BBOX = ['40.72', '40.76', '-74.19', '-74.15'];

interface StubRes {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}
const res = (status: number, body: unknown): StubRes => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/**
 * Build a fetch stub: Nominatim → fixed bbox; each subsequent Overpass call pops the
 * next queued response (clamps to the last, so a single response repeats forever).
 */
function makeFetch(overpassQueue: StubRes[]): jest.Mock {
  let i = 0;
  return jest.fn(async (url: string) => {
    if (String(url).includes('nominatim')) {
      return res(200, [{ boundingbox: NEWARK_BBOX }]);
    }
    const r = overpassQueue[Math.min(i, overpassQueue.length - 1)];
    i++;
    return r;
  });
}

const populated = res(200, {
  elements: [
    {
      type: 'node',
      id: 1,
      tags: { name: 'Joe Pizza', amenity: 'restaurant', phone: '+19735550100', 'contact:instagram': 'joepizza' },
    },
    { type: 'node', id: 2, tags: { name: 'Bar X', amenity: 'restaurant' } },
  ],
});
const empty200 = res(200, { elements: [] });
const gateway504 = res(504, {});
const err503 = res(503, {});

describe('discoverLeadsForQuery — Overpass mirror fallback', () => {
  beforeEach(() => {
    // Neutralize the inter-mirror politeness sleeps so the suite stays fast.
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
  });
  afterEach(() => jest.restoreAllMocks());

  it('does NOT short-circuit on a 200-with-0-elements mirror — keeps trying until data', async () => {
    // mirror0 504 (error) → mirror1 200-EMPTY (the false-empty) → mirror2 200-POPULATED.
    const fetchStub = makeFetch([gateway504, empty200, populated]);
    const { results, degraded } = await discoverLeadsForQuery('restaurants in Newark NJ', fetchStub as unknown as typeof fetch);
    expect(results.length).toBe(2); // OLD code returned 0 here (accepted the empty 200)
    expect(degraded).toBeNull();
    // contact captured from OSM tags flows through to the PlacesResult
    const joe = results.find((r) => r.name === 'Joe Pizza');
    expect(joe?.phone).toBe('+19735550100');
    expect(joe?.socials?.instagram).toBeTruthy();
  });

  it('returns an honest empty (no error) when EVERY mirror authoritatively says empty', async () => {
    const fetchStub = makeFetch([empty200]); // every mirror + round → 200 empty
    const { results, degraded } = await discoverLeadsForQuery('restaurants in Nowhere ND', fetchStub as unknown as typeof fetch);
    expect(results).toEqual([]);
    expect(degraded).toBeNull(); // genuine empty area — NOT a transport failure
  });

  it('surfaces an honest degraded note when every mirror errors (transport failure)', async () => {
    const fetchStub = makeFetch([err503]); // no mirror ever answers 2xx
    const { results, degraded } = await discoverLeadsForQuery('restaurants in Newark NJ', fetchStub as unknown as typeof fetch);
    expect(results).toEqual([]);
    expect(degraded).toMatch(/overpass/i); // "Overpass lookup failed (...)"
  });
});
