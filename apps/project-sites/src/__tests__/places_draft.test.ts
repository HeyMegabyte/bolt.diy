import { placesToDraft, categoryFromTypes } from '../services/places_draft.js';
import type { PlacesResult } from '../services/google_places.js';

function makePlace(overrides: Partial<PlacesResult> = {}): PlacesResult {
  return {
    place_id: 'place_123',
    name: "Vito's Mens Salon",
    formatted_address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
    phone: '(973) 555-0142',
    website: 'https://vitos.example',
    rating: 4.8,
    review_count: 211,
    hours: [
      { day: 'Monday', open: '9:00 AM', close: '6:00 PM', closed: false },
      { day: 'Sunday', open: null, close: null, closed: true },
    ],
    geo: { lat: 40.9, lng: -74.4 },
    maps_url: 'https://maps.google.com/?cid=1',
    photos: [
      { url: 'https://img/1.jpg', attribution: 'a', width: 800, height: 600 },
      { url: 'https://img/2.jpg', attribution: 'b', width: 800, height: 600 },
    ],
    types: ['hair_care', 'point_of_interest', 'establishment'],
    price_level: 2,
    reviews: [],
    business_status: 'OPERATIONAL',
    ...overrides,
  };
}

describe('categoryFromTypes (#54 prefill_from_places)', () => {
  it('prefers a mapped friendly label over generic types', () => {
    expect(categoryFromTypes(['hair_care', 'point_of_interest'])).toBe('Hair Salon');
  });

  it('title-cases the first non-generic type when no mapping exists', () => {
    expect(categoryFromTypes(['art_gallery', 'establishment'])).toBe('Art Gallery');
  });

  it('returns null when only generic types are present', () => {
    expect(categoryFromTypes(['establishment', 'point_of_interest'])).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(categoryFromTypes([])).toBeNull();
    expect(categoryFromTypes(null)).toBeNull();
    expect(categoryFromTypes(undefined)).toBeNull();
  });
});

describe('placesToDraft (#54 prefill_from_places — pure mapper)', () => {
  it('maps the core fields from a full Places result', () => {
    const d = placesToDraft(makePlace());
    expect(d.placeId).toBe('place_123');
    expect(d.businessName).toBe("Vito's Mens Salon");
    expect(d.address).toBe('74 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
    expect(d.phone).toBe('(973) 555-0142');
    expect(d.website).toBe('https://vitos.example');
    expect(d.category).toBe('Hair Salon');
    expect(d.priceTier).toBe('$$');
    expect(d.rating).toBe(4.8);
    expect(d.reviewCount).toBe(211);
    expect(d.mapsUrl).toBe('https://maps.google.com/?cid=1');
  });

  it('formats hours rows (open range + Closed)', () => {
    const d = placesToDraft(makePlace());
    expect(d.hours).toEqual([
      { day: 'Monday', hours: '9:00 AM – 6:00 PM' },
      { day: 'Sunday', hours: 'Closed' },
    ]);
  });

  it('caps photo URLs at 6 and drops empties', () => {
    const photos = Array.from({ length: 9 }, (_, i) => ({
      url: i === 3 ? '' : `https://img/${i}.jpg`,
      attribution: 'x',
      width: 1,
      height: 1,
    }));
    const d = placesToDraft(makePlace({ photos }));
    expect(d.photoUrls).toHaveLength(6);
    expect(d.photoUrls).not.toContain('');
  });

  it('computes completeness as filled/8 fields → 100 for a full result', () => {
    expect(placesToDraft(makePlace()).completeness).toBe(100);
  });

  it('lowers completeness when fields are missing', () => {
    const d = placesToDraft(
      makePlace({
        phone: null,
        website: null,
        rating: null,
        hours: null,
        photos: [],
        types: ['establishment'],
      }),
    );
    // only name + address filled → 2/8 = 25
    expect(d.completeness).toBe(25);
    expect(d.category).toBeNull();
    expect(d.priceTier).toBe('$$');
  });

  it('never throws on a sparse result (all-nullable fields absent)', () => {
    const sparse = makePlace({
      name: '' as unknown as string,
      formatted_address: '',
      phone: null,
      website: null,
      rating: null,
      review_count: null,
      hours: null,
      maps_url: null,
      photos: [],
      types: [],
      price_level: null,
    });
    const d = placesToDraft(sparse);
    expect(d.businessName).toBe('');
    expect(d.hours).toEqual([]);
    expect(d.photoUrls).toEqual([]);
    expect(d.completeness).toBe(0);
    expect(d.priceTier).toBeNull();
  });
});
