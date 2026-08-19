/**
 * Query-first lead discovery — free OSM fallback for the Lead Scanner (#9).
 *
 * Google Places Text Search was the scanner's only source and it is
 * `REQUEST_DENIED` (GCP billing not enabled) — every scan silently returned
 * `{ scanned: 0 }` while the UI said "Scanned 0 · added 0". This module is the
 * no-key, free replacement: parse a natural-language query ("hair salons in
 * Brooklyn NY") → geocode the place phrase via Nominatim → run a category-
 * precise Overpass query for businesses WITHOUT a website tag → map to
 * {@link PlacesResult} so the existing score/scan/store pipeline is unchanged.
 *
 * Design:
 * - Category phrase is STRIPPED from the query before geocoding (Nominatim
 *   returns a POI-sized bbox for "bakeries in Portland" but a city bbox for
 *   "Portland" — verified live).
 * - `QUERY_CATEGORY_OVERPASS` maps category phrases to `["key"="value"]`
 *   clauses; unknown phrases fall back to broad category KEYS (`shop|craft|
 *   office|amenity`) — the existing OSM engine's proven approach.
 * - Two Overpass mirrors with a single retry (the main server 429s under
 *   load); Overpass results are capped so a dense metro doesn't blow the
 *   scanner/CRM budget.
 * - Never throws — returns `{ results, degraded }` where `degraded` describes
 *   the first failure mode (or null) so the route can surface an honest error
 *   instead of a lying "0".
 *
 * @packageDocumentation
 */

import type { PlacesResult } from './google_places.js';

/** Mirror list for the free Overpass API. Worker egress IPs are SHARED + heavily
 * rate-limited by the main server (429s observed live), so the list spans
 * independent operators and attempts spread across them with a delay. */
const OVERPASS_MIRRORS: ReadonlyArray<string> = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

/** Free Nominatim instance for query → bbox geocoding. */
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

/** Identifying UA — overpass-api.de 406s the undici default (`User-Agent: node`)
 * and browser-mimicking UAs; only contact-identified UAs (like curl's) pass. */
const EXTERNAL_UA = 'projectsites.dev/1.0 (contact: brian@megabyte.space)';

/**
 * Strip a leading category phrase from a natural-language scan query so the
 * remainder geocodes as a PLACE, not a POI.
 *
 * @example
 * stripCategoryPhrase('hair salons in Brooklyn NY'); // 'Brooklyn NY'
 */
export function stripCategoryPhrase(query: string): string {
  return query
    .replace(
      /^(plumbers|roofers|hair salons|barbers|barber shops|electricians|dentists|lawyers|attorneys|restaurants|cafes|cafés|coffee shops|gyms|florists|cleaners|bakers|bakeries|auto repair|auto shops|mechanics|contractors|painters|landscapers|pest control|photographers|tutors|accountants|massage therapists|nail salons|pet groomers|dog groomers|vets|veterinarians|chiropractors|tattoo artists|furniture movers|movers|print shops|tailors|shoe repair|watch repair|computer repair|phone repair|caterers|party planners|wedding planners|event venues|driving schools|martial arts|yoga studios|pilates|tanning salons|insurance agents|real estate agents|travel agents|notaries|tax preparers) (in|near|around|at) /i,
      '',
    )
    .trim();
}

/**
 * Map a query's category phrase to precise OSM tag clauses. Includes plural
 * synonyms OSM actually uses (a metro often has zero `craft=plumber` but many
 * `craft=plumbing`).
 */
export const QUERY_CATEGORY_OVERPASS: Readonly<Record<string, ReadonlyArray<string>>> = {
  plumbers: ['craft=plumber', 'craft=plumbing'],
  roofers: ['craft=roofer', 'craft=roofing'],
  'hair salons': ['shop=hairdresser', 'shop=beauty'],
  barbers: ['shop=hairdresser'],
  'barber shops': ['shop=hairdresser'],
  electricians: ['craft=electrician'],
  dentists: ['amenity=dentist'],
  lawyers: ['office=lawyer'],
  attorneys: ['office=lawyer'],
  restaurants: ['amenity=restaurant'],
  cafes: ['amenity=cafe'],
  cafés: ['amenity=cafe'],
  'coffee shops': ['amenity=cafe'],
  gyms: ['leisure=fitness_centre', 'leisure=sports_centre'],
  florists: ['shop=florist'],
  cleaners: ['shop=laundry', 'shop=dry_cleaning'],
  bakers: ['shop=bakery', 'craft=bakery'],
  bakeries: ['shop=bakery', 'craft=bakery'],
  'auto repair': ['shop=car_repair', 'shop=car_parts'],
  'auto shops': ['shop=car_repair', 'shop=car_parts'],
  mechanics: ['shop=car_repair'],
  contractors: ['craft=general_contractor', 'office=construction_company'],
  painters: ['craft=painter', 'craft=construction'],
  landscapers: ['shop=garden_centre', 'craft=gardener', 'craft=landscaping'],
  'pest control': ['craft=pest_control'],
  photographers: ['craft=photographer', 'office=photographer'],
  tutors: ['office=educational_institution'],
  accountants: ['office=accountant', 'office=tax_advisor'],
  'massage therapists': ['shop=massage'],
  'nail salons': ['shop=beauty'],
  'pet groomers': ['shop=pet_grooming'],
  'dog groomers': ['shop=pet_grooming'],
  vets: ['amenity=veterinary'],
  veterinarians: ['amenity=veterinary'],
  chiropractors: ['healthcare=alternative'],
  'tattoo artists': ['shop=tattoo'],
  'furniture movers': ['office=moving_company'],
  movers: ['office=moving_company'],
  'print shops': ['shop=copyshop'],
  tailors: ['shop=tailor', 'craft=tailor'],
  'shoe repair': ['craft=shoemaker'],
  'watch repair': ['craft=watchmaker'],
  'computer repair': ['shop=computer'],
  'phone repair': ['shop=mobile_phone'],
  caterers: ['craft=caterer', 'amenity=catering'],
  'party planners': ['office=event_management'],
  'wedding planners': ['office=event_management'],
  'event venues': ['amenity=events_venue'],
  'driving schools': ['amenity=driving_school'],
  'martial arts': ['leisure=sports_centre'],
  'yoga studios': ['leisure=fitness_centre'],
  pilates: ['leisure=fitness_centre'],
  'tanning salons': ['shop=beauty'],
  'insurance agents': ['office=insurance'],
  'real estate agents': ['office=estate_agent'],
  'travel agents': ['office=travel_agent'],
  notaries: ['office=notary'],
  'tax preparers': ['office=tax_advisor'],
};

/** Category KEYS (not values) — the broad fallback when no phrase matches. */
const FALLBACK_CATEGORY_KEYS: ReadonlyArray<string> = ['shop', 'craft', 'office', 'amenity'];

/** Cap per Overpass run so a dense metro never blows the scan budget. */
export const OSM_DISCOVERY_CAP = 200;

/** The minimal overpass shape we read. */
interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
}

/** Normalized business discovered from a query. */
export interface DiscoveredCandidate {
  name: string;
  address?: string;
  category?: string;
}

/**
 * Extract the FIRST category phrase present in the query, or null.
 *
 * @example
 * pickCategoryPhrase('bakeries in Portland OR'); // 'bakeries'
 */
export function pickCategoryPhrase(query: string): string | null {
  for (const phrase of Object.keys(QUERY_CATEGORY_OVERPASS)) {
    if (query.toLowerCase().includes(phrase)) return phrase;
  }
  return null;
}

/**
 * Geocode a place phrase to a bounding box via free Nominatim.
 *
 * @returns `[south, west, north, east]`, or null when the phrase is empty or
 *   unresolvable.
 */
export async function geocodeBbox(
  placePhrase: string,
  fetchImpl: typeof fetch = fetch,
): Promise<[number, number, number, number] | null> {
  const q = placePhrase.trim();
  if (!q) return null;
  try {
    const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': EXTERNAL_UA } });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ boundingbox?: string[] }>;
    const box = data[0]?.boundingbox;
    if (!box || box.length < 4) return null;
    const [s, n, w, e] = [Number(box[0]), Number(box[1]), Number(box[2]), Number(box[3])];
    if (!Number.isFinite(s) || !Number.isFinite(n) || !Number.isFinite(w) || !Number.isFinite(e)) {
      return null;
    }
    return [s, w, n, e];
  } catch {
    return null;
  }
}

/**
 * Build the Overpass QL for siteless businesses in a bbox: precise
 * `["key"="value"]` clauses when the category phrase is known, else the broad
 * category-KEY shape from the OSM engine.
 */
export function buildOverpassFor(
  categoryPhrase: string | null,
  bbox: [number, number, number, number],
): string {
  const [s, w, n, e] = bbox;
  const area = `(${s},${w},${n},${e})`;
  const siteless = '[!"website"][!"contact:website"]';
  const clauses: string[] = [];
  if (categoryPhrase) {
    for (const kv of QUERY_CATEGORY_OVERPASS[categoryPhrase] ?? []) {
      const [key, value] = kv.split('=');
      clauses.push(`  node["${key}"="${value}"]["name"]${siteless}${area};`);
      clauses.push(`  way["${key}"="${value}"]["name"]${siteless}${area};`);
    }
  }
  if (clauses.length === 0) {
    for (const key of FALLBACK_CATEGORY_KEYS) {
      clauses.push(`  node["${key}"]["name"]${siteless}${area};`);
      clauses.push(`  way["${key}"]["name"]${siteless}${area};`);
    }
  }
  return `[out:json][timeout:60];\n(\n${clauses.join('\n')}\n);\nout center tags 200;`;
}

/** Compose a one-line address from OSM addr tags (best-effort). */
function osmAddress(tags: Record<string, string>): string | undefined {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:state'],
    tags['addr:postcode'],
  ].filter((p) => p && p.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** Human category from the first populated category tag. */
function osmCategory(tags: Record<string, string>): string | undefined {
  for (const k of ['shop', 'craft', 'office', 'amenity', 'leisure', 'healthcare']) {
    if (tags[k]) return tags[k];
  }
  return undefined;
}

/** Delay between mirror attempts — shared egress IPs trip Overpass rate limits;
 * spreading attempts in time is what makes the fallback actually succeed. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch Overpass across mirrors with a delay between attempts, two rounds, and
 * backoff after a 429. Never throws to the caller beyond a final descriptive
 * error.
 */
async function fetchOverpass(query: string, fetchImpl: typeof fetch): Promise<OverpassElement[]> {
  let lastErr: unknown = null;
  for (let round = 0; round < 2; round++) {
    for (const base of OVERPASS_MIRRORS) {
      try {
        const res = await fetchImpl(base, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': EXTERNAL_UA,
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok) {
          lastErr = new Error(`overpass ${res.status}`);
          // 429 = rate limited — back off harder before the next attempt.
          if (res.status === 429) await sleep(2500);
          continue;
        }
        const body = (await res.json().catch(() => ({}))) as { elements?: OverpassElement[] };
        return Array.isArray(body.elements) ? body.elements : [];
      } catch (err) {
        lastErr = err;
      }
      await sleep(1200); // politeness + shared-IP rate-limit relief
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('overpass unavailable');
}

/**
 * Discover siteless businesses for a natural-language query using only free
 * sources (Nominatim + Overpass). The no-key fallback for the Places scan.
 *
 * @returns `{ results, degraded }` — `results` are mapped to the
 *   {@link PlacesResult} shape the scanner pipeline already consumes;
 *   `degraded` names the first failure mode (or null on full success) so the
 *   route can surface an honest error. Never throws.
 */
export async function discoverLeadsForQuery(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ results: PlacesResult[]; degraded: string | null }> {
  const category = pickCategoryPhrase(query);
  const placePhrase = stripCategoryPhrase(query);
  const bbox = await geocodeBbox(placePhrase, fetchImpl);
  if (!bbox) {
    return {
      results: [],
      degraded: `Could not geocode "${placePhrase || query}" (free Nominatim lookup).`,
    };
  }
  let elements: OverpassElement[];
  try {
    elements = await fetchOverpass(buildOverpassFor(category, bbox), fetchImpl);
  } catch (err) {
    return { results: [], degraded: `Overpass lookup failed (${String(err)}).` };
  }

  const results: PlacesResult[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const name = tags['name']?.trim();
    if (!name) continue;
    const key = el.id != null && el.type ? `osm:${el.type}/${el.id}` : name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const address = osmAddress(tags);
    const cat = osmCategory(tags);
    results.push({
      place_id: key,
      name,
      formatted_address: address ?? '',
      phone: null,
      website: null,
      rating: null,
      review_count: null,
      hours: null,
      geo: null,
      maps_url: null,
      photos: [],
      types: cat ? [cat] : [],
      price_level: null,
      reviews: [],
      business_status: null,
    });
    if (results.length >= OSM_DISCOVERY_CAP) break;
  }
  return { results, degraded: null };
}
