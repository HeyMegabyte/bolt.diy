/**
 * Multi-result Google Places text search — the lead scanner's discovery call (#9).
 *
 * @remarks
 * Distinct from `google_places.ts` `lookupBusiness` (which resolves ONE business
 * to full details). The scanner needs the FULL result list for a query like
 * "roofers in Newark NJ". Text Search omits website/phone (those need a Details
 * call per hit — the enrichment step), so this returns lightweight hits; the
 * scan route enriches the no-website candidates downstream. DI'd fetch →
 * unit-provable; never throws (returns `[]` on missing key / error / non-OK).
 *
 * @example
 * ```ts
 * const hits = await searchPlacesByQuery(env.GOOGLE_PLACES_API_KEY, 'roofers newark nj');
 * ```
 */

/** A lightweight Text Search hit (pre-Details-enrichment). */
export interface PlacesSearchHit {
  place_id: string;
  name: string;
  formatted_address: string;
  types: string[];
  rating: number | null;
  reviewCount: number | null;
  businessStatus: string | null;
}

interface RawHit {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  types?: string[];
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
}

/**
 * Run a Google Places Text Search and return the lightweight hits.
 *
 * @param apiKey - Google Places API key (empty/undefined → `[]`, no call).
 * @param query - The free-text search (e.g. "plumbers in Austin TX").
 * @param fetchImpl - Injected for tests; defaults to global `fetch`.
 * @returns The hits (only those with a `place_id` + `name`); `[]` on any failure.
 */
export async function searchPlacesByQuery(
  apiKey: string | undefined,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlacesSearchHit[]> {
  if (!apiKey) return [];
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`;
    const res = await fetchImpl(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { status?: string; results?: RawHit[] };
    if (data.status !== 'OK' || !Array.isArray(data.results)) return [];
    const hits: PlacesSearchHit[] = [];
    for (const r of data.results) {
      if (!r.place_id || !r.name) continue;
      hits.push({
        place_id: r.place_id,
        name: r.name,
        formatted_address: r.formatted_address ?? '',
        types: Array.isArray(r.types) ? r.types : [],
        rating: typeof r.rating === 'number' ? r.rating : null,
        reviewCount: typeof r.user_ratings_total === 'number' ? r.user_ratings_total : null,
        businessStatus: r.business_status ?? null,
      });
    }
    return hits;
  } catch {
    return [];
  }
}
