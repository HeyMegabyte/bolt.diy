/**
 * OSM-first lead discovery — free OpenStreetMap Overpass provider for the
 * automatic Lead Scanner. Discovers businesses WITHOUT a website tag (the prime
 * lead signal) at zero API cost, so Google Places budget is spent only to
 * confirm. See `docs/lead-scanner/automatic-engine.md` (top-14 #4).
 *
 * @remarks
 * `buildOverpassQuery`, `tagsHaveWebsite`, and `osmElementToBusiness` are PURE
 * (testable, no I/O). `fetchOverpassElements` + `discoverSitelessFromOsm` are
 * thin, never-throw `fetch` wrappers over the public Overpass endpoint.
 *
 * @packageDocumentation
 */

import type { DiscoveredBusiness } from './crm_leads.js';
import { extractSocialsFromOsmTags } from './social_links.js';

/** Public Overpass interpreter endpoint (free, no key). */
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** A raw Overpass element (locally declared — only the fields we read). */
export interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
}

/** Options for an Overpass siteless-business query. */
export interface OverpassQueryOpts {
  /** Bounding box [south, west, north, east]. */
  bbox: [number, number, number, number];
  /** OSM category tags to include, e.g. ['shop', 'craft', 'amenity']. */
  categories?: string[];
  /** Server-side timeout (seconds). */
  timeoutSec?: number;
}

const DEFAULT_CATEGORY_KEYS = ['shop', 'craft', 'office', 'amenity'];

/** True when the tag set already advertises a website (→ NOT a lead). */
export function tagsHaveWebsite(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const keys = ['website', 'contact:website', 'url', 'website:en'];
  return keys.some((k) => {
    const v = tags[k];
    return typeof v === 'string' && v.trim() !== '';
  });
}

/**
 * Build an Overpass QL query for businesses in a bbox that have a name but NO
 * website tag, across the given category keys.
 *
 * @param opts - {@link OverpassQueryOpts}.
 * @returns An Overpass QL string (JSON output).
 *
 * @example
 * ```ts
 * buildOverpassQuery({ bbox: [40.0, -74.3, 40.1, -74.2], categories: ['shop'] });
 * ```
 */
export function buildOverpassQuery(opts: OverpassQueryOpts): string {
  const timeout = opts.timeoutSec ?? 60;
  const cats =
    opts.categories && opts.categories.length > 0 ? opts.categories : DEFAULT_CATEGORY_KEYS;
  const [s, w, n, e] = opts.bbox;
  const bbox = `${s},${w},${n},${e}`;
  // For each category key: nodes with that key + a name, lacking any website tag.
  const clauses = cats
    .map(
      (key) =>
        `  node["${key}"]["name"][!"website"][!"contact:website"](${bbox});\n` +
        `  way["${key}"]["name"][!"website"][!"contact:website"](${bbox});`,
    )
    .join('\n');
  return `[out:json][timeout:${timeout}];\n(\n${clauses}\n);\nout center tags 200;`;
}

/** Compose a single-line address from OSM `addr:*` tags (best-effort). */
function osmAddress(tags: Record<string, string>): string | undefined {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:city'],
    tags['addr:state'],
    tags['addr:postcode'],
  ].filter((p) => p && p.trim() !== '');
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** Pick a human category from the common OSM category keys. */
function osmCategory(tags: Record<string, string>): string | undefined {
  for (const k of ['shop', 'craft', 'office', 'amenity']) {
    if (tags[k]) return tags[k];
  }
  return undefined;
}

/**
 * Map an Overpass element to a {@link DiscoveredBusiness}, or null when it has a
 * website (not a lead) or no name (not usable).
 *
 * @param el - A raw {@link OverpassElement}.
 * @returns A discovered business, or null to skip.
 */
export function osmElementToBusiness(el: OverpassElement): DiscoveredBusiness | null {
  const tags = el.tags;
  if (!tags || !tags['name'] || tags['name'].trim() === '') return null;
  if (tagsHaveWebsite(tags)) return null;

  const biz: DiscoveredBusiness = { businessName: tags['name'] };
  const addr = osmAddress(tags);
  if (addr) biz.address = addr;
  const phone = tags['phone'] ?? tags['contact:phone'];
  if (phone) biz.phone = phone;
  const email = tags['email'] ?? tags['contact:email'];
  if (email) biz.email = email;
  const socials = extractSocialsFromOsmTags(tags);
  if (Object.keys(socials).length > 0) biz.socials = socials;
  const cat = osmCategory(tags);
  if (cat) biz.category = cat;
  if (el.type && el.id != null) biz.externalId = `osm:${el.type}/${el.id}`;
  return biz;
}

/**
 * Fetch Overpass elements for a query. Never throws — returns [] on any error.
 *
 * @param query - Overpass QL (from {@link buildOverpassQuery}).
 * @param fetchImpl - Injectable fetch (tests pass a stub).
 * @returns Raw elements (possibly empty).
 */
export async function fetchOverpassElements(
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OverpassElement[]> {
  try {
    const res = await fetchImpl(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as { elements?: OverpassElement[] };
    return Array.isArray(body.elements) ? body.elements : [];
  } catch {
    return [];
  }
}

/**
 * Discover siteless businesses in a bbox via OSM. Never throws.
 *
 * @param opts - {@link OverpassQueryOpts}.
 * @param fetchImpl - Injectable fetch.
 * @returns De-duped {@link DiscoveredBusiness}[] (by externalId/name).
 */
export async function discoverSitelessFromOsm(
  opts: OverpassQueryOpts,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveredBusiness[]> {
  const elements = await fetchOverpassElements(buildOverpassQuery(opts), fetchImpl);
  const seen = new Set<string>();
  const out: DiscoveredBusiness[] = [];
  for (const el of elements) {
    const biz = osmElementToBusiness(el);
    if (!biz) continue;
    const key = biz.externalId ?? biz.businessName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(biz);
  }
  return out;
}
