/**
 * @module services/places_draft
 * @description #54 `prefill_from_places` — pure mapper that turns a Google
 * {@link PlacesResult} into a {@link BuildDraft}: the business-detail form a
 * non-technical owner would otherwise type by hand. On business-search select
 * the build form is pre-filled ~80% BEFORE signup, collapsing the #1 friction
 * for SMB owners. Zero-I/O: the caller resolves the Places lookup + caches the
 * draft per `place_id`; this layer is a deterministic transform so it unit-tests
 * with no network.
 *
 * @packageDocumentation
 */

import type { PlacesResult } from './google_places.js';

/** One day's opening-hours line, pre-formatted for display. */
export interface DraftHours {
  /** Day name, e.g. `"Monday"`. */
  readonly day: string;
  /** `"9:00 AM – 5:00 PM"` or `"Closed"`. */
  readonly hours: string;
}

/** The build-form draft a Places result pre-fills. */
export interface BuildDraft {
  readonly placeId: string;
  readonly businessName: string;
  readonly address: string;
  readonly phone: string | null;
  readonly website: string | null;
  /** Friendly business category derived from Places `types[]`, or null. */
  readonly category: string | null;
  /** `"$"`–`"$$$$"` from `price_level`, or null. */
  readonly priceTier: string | null;
  readonly rating: number | null;
  readonly reviewCount: number | null;
  readonly mapsUrl: string | null;
  readonly hours: readonly DraftHours[];
  /** Up to 6 photo URLs (re-fetch on render — Places URLs are short-lived). */
  readonly photoUrls: readonly string[];
  /**
   * 0–100 — how much of the form this draft pre-fills, so the UI can show
   * "~80% done" and nudge the owner to fill the rest.
   */
  readonly completeness: number;
}

/** Friendly labels for common Google Places `types` (first match wins). */
const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  hair_care: 'Hair Salon',
  beauty_salon: 'Beauty Salon',
  barber_shop: 'Barber Shop',
  restaurant: 'Restaurant',
  cafe: 'Café',
  bakery: 'Bakery',
  bar: 'Bar',
  meal_takeaway: 'Takeout',
  food: 'Food & Drink',
  gym: 'Gym & Fitness',
  spa: 'Spa',
  lawyer: 'Law Firm',
  dentist: 'Dental Practice',
  doctor: 'Medical Practice',
  veterinary_care: 'Veterinary Clinic',
  real_estate_agency: 'Real Estate',
  car_repair: 'Auto Repair',
  plumber: 'Plumbing',
  electrician: 'Electrical',
  roofing_contractor: 'Roofing',
  general_contractor: 'Contractor',
  store: 'Retail Store',
  clothing_store: 'Clothing Store',
  florist: 'Florist',
  church: 'Place of Worship',
  school: 'School',
  lodging: 'Hotel & Lodging',
};

/** Generic Places types that carry no useful category meaning. */
const GENERIC_TYPES: ReadonlySet<string> = new Set([
  'point_of_interest',
  'establishment',
  'premise',
  'street_address',
  'geocode',
]);

/**
 * Title-case a snake_case Places type as a fallback label, e.g.
 * `"art_gallery"` → `"Art Gallery"`.
 */
function titleizeType(type: string): string {
  return type
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Derive a friendly business category from Places `types[]`. Prefers the first
 * mapped label; else title-cases the first non-generic type; else null.
 *
 * @param types - Google Places `types[]` (may be empty).
 * @returns A human label or null when only generic types are present.
 *
 * @example
 * categoryFromTypes(['hair_care', 'point_of_interest']) // → 'Hair Salon'
 * categoryFromTypes(['art_gallery'])                    // → 'Art Gallery'
 * categoryFromTypes(['establishment'])                  // → null
 */
export function categoryFromTypes(types: readonly string[] | null | undefined): string | null {
  if (!types?.length) return null;
  for (const t of types) {
    if (CATEGORY_LABELS[t]) return CATEGORY_LABELS[t];
  }
  for (const t of types) {
    if (!GENERIC_TYPES.has(t)) return titleizeType(t);
  }
  return null;
}

/** Map a 0–4 `price_level` to `$`–`$$$$` (null when out of range). */
function priceTier(level: number | null): string | null {
  if (typeof level !== 'number' || level < 1 || level > 4) return null;
  return '$'.repeat(Math.round(level));
}

/** Format one Places hours row into a display line. */
function formatHours(row: NonNullable<PlacesResult['hours']>[number]): DraftHours {
  if (row.closed || (!row.open && !row.close)) {
    return { day: row.day, hours: 'Closed' };
  }
  return { day: row.day, hours: `${row.open ?? '—'} – ${row.close ?? '—'}` };
}

/**
 * Transform a {@link PlacesResult} into a {@link BuildDraft} for the build form.
 * Pure + defensive: every absent field maps to `null`/empty, never throws.
 *
 * @param place - Normalized Places lookup result.
 * @returns The pre-filled {@link BuildDraft} (cache per `place.place_id`).
 *
 * @example
 * const draft = placesToDraft(place);
 * // → { businessName, address, phone, category: 'Hair Salon', completeness: 78, ... }
 */
export function placesToDraft(place: PlacesResult): BuildDraft {
  const hours = Array.isArray(place.hours) ? place.hours.map(formatHours) : [];
  const photoUrls = Array.isArray(place.photos)
    ? place.photos
        .map((p) => p.url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .slice(0, 6)
    : [];
  const category = categoryFromTypes(place.types);

  // Completeness: 8 weighted form fields the owner would otherwise type.
  const checks: Array<boolean> = [
    Boolean(place.name),
    Boolean(place.formatted_address),
    Boolean(place.phone),
    Boolean(place.website),
    Boolean(category),
    hours.length > 0,
    photoUrls.length > 0,
    typeof place.rating === 'number',
  ];
  const filled = checks.filter(Boolean).length;
  const completeness = Math.round((filled / checks.length) * 100);

  return {
    placeId: place.place_id,
    businessName: place.name ?? '',
    address: place.formatted_address ?? '',
    phone: place.phone ?? null,
    website: place.website ?? null,
    category,
    priceTier: priceTier(place.price_level),
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviewCount: typeof place.review_count === 'number' ? place.review_count : null,
    mapsUrl: place.maps_url ?? null,
    hours,
    photoUrls,
    completeness,
  };
}
