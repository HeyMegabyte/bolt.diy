/**
 * @module __tests__/confidence_scoring
 * @description Unit tests for pure scoring/branching logic in confidence.ts.
 *
 * All tests use transformToV3 (the only public export) to exercise:
 *   - getCorroborationBoost (via mergeConf paths)
 *   - isImageRelevant (via media.hero_images / gallery filtering)
 *   - computeSectionConfidence (via provenance.sectionConfidence)
 *   - llmInferred penalty (operations.payments / amenities / accessibility)
 *   - conf() confidence penalty for null/empty/placeholder values
 *   - str / num / arr / strArr internal helpers (via field shape assertions)
 *   - placeholder() values and isPlaceholder flag
 *   - mergeConf deduplication and corroboration boost
 *   - warning accumulation for missing fields
 *   - SEO, brand, marketing sections
 */

import { transformToV3 } from '../services/confidence.js';
import type { RawResearch } from '../services/confidence.js';
import type { PlacesResult } from '../services/google_places.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRaw(overrides: Partial<RawResearch> = {}): RawResearch {
  return {
    profile: {},
    social: {},
    brand: {},
    sellingPoints: {},
    images: {},
    ...overrides,
  };
}

function makePlaces(overrides: Partial<PlacesResult> = {}): PlacesResult {
  return {
    place_id: 'test-place-id',
    name: 'Test Business',
    formatted_address: '1 Main St, City, ST 00000',
    phone: '+15550000000',
    website: 'https://example.com',
    rating: 4.5,
    review_count: 50,
    hours: null,
    geo: { lat: 40.0, lng: -74.0 },
    maps_url: 'https://maps.google.com/?cid=1',
    photos: [],
    types: ['business'],
    price_level: null,
    reviews: [],
    business_status: 'OPERATIONAL',
    ...overrides,
  };
}

type V3 = Record<string, unknown>;
type Conf = {
  value: unknown;
  confidence: number;
  sources: Array<{ kind: string; id?: string }>;
  rationale?: string;
  isPlaceholder?: boolean;
};

function asConf(v: unknown): Conf {
  return v as Conf;
}

// ─── BASE_CONFIDENCE values ───────────────────────────────────────────────────

describe('BASE_CONFIDENCE tiers (via conf kind)', () => {
  it('llm_generated fields start at 0.5', () => {
    const v3 = transformToV3(makeRaw({ profile: { tagline: 'Hello' } }), null, {
      businessName: 'Biz',
    }) as V3;
    const id = v3.identity as V3;
    const tagline = asConf(id.tagline);
    expect(tagline.confidence).toBe(0.5);
    expect(tagline.sources[0].kind).toBe('llm_generated');
  });

  it('google_places fields start at 0.92 (or higher after corroboration)', () => {
    const places = makePlaces({ phone: '+15550001111' });
    const v3 = transformToV3(makeRaw(), places, { businessName: 'Biz' }) as V3;
    const id = v3.identity as V3;
    const phone = asConf(id.phone);
    // google_places base = 0.92; with corroboration it can be higher
    expect(phone.confidence).toBeGreaterThanOrEqual(0.92);
    expect(phone.sources.some((s) => s.kind === 'google_places')).toBe(true);
  });

  it('user_provided fields reach >=0.9', () => {
    const v3 = transformToV3(makeRaw(), null, {
      businessName: 'Biz',
      businessPhone: '+15559999999',
    }) as V3;
    const id = v3.identity as V3;
    const phone = asConf(id.phone);
    // user_provided base = 0.9; merged with llm = merge picks higher + boost
    expect(phone.confidence).toBeGreaterThanOrEqual(0.9);
    expect(phone.sources.some((s) => s.kind === 'user_provided')).toBe(true);
  });

  it('internal_inference (placeholder) starts at 0.45 then loses 0.1 for isPlaceholder', () => {
    // holiday_hours is always a placeholder
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const ops = v3.operations as V3;
    const holiday = asConf(ops.holiday_hours);
    expect(holiday.isPlaceholder).toBe(true);
    // 0.45 base - 0.10 isPlaceholder penalty = 0.35
    expect(holiday.confidence).toBe(0.35);
    expect(holiday.sources[0].kind).toBe('internal_inference');
  });
});

// ─── NULL / EMPTY VALUE PENALTY ───────────────────────────────────────────────

describe('conf() empty/null value penalty (-0.15)', () => {
  it('applies penalty when LLM phone is null', () => {
    // profile.phone is undefined => str() returns null => penalty applies
    const v3 = transformToV3(makeRaw({ profile: {} }), null, { businessName: 'Biz' }) as V3;
    const id = v3.identity as V3;
    const phone = asConf(id.phone);
    // 0.5 (llm) - 0.15 (null) = 0.35
    expect(phone.confidence).toBe(0.35);
    expect(phone.value).toBeNull();
  });

  it('applies penalty when LLM email is null string (empty string becomes null)', () => {
    const v3 = transformToV3(makeRaw({ profile: { email: '' } }), null, {
      businessName: 'Biz',
    }) as V3;
    const id = v3.identity as V3;
    const email = asConf(id.email);
    // str('') returns null => penalty applies
    expect(email.confidence).toBe(0.35);
    expect(email.value).toBeNull();
  });

  it('does not apply penalty when value is present', () => {
    const v3 = transformToV3(makeRaw({ profile: { email: 'hi@example.com' } }), null, {
      businessName: 'Biz',
    }) as V3;
    const id = v3.identity as V3;
    const email = asConf(id.email);
    expect(email.confidence).toBe(0.5);
    expect(email.value).toBe('hi@example.com');
  });

  it('zero-floors confidence, never goes negative', () => {
    // internal_inference placeholder: 0.45 - 0.10 (placeholder) = 0.35; value=[] so no null penalty
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const ops = v3.operations as V3;
    const holiday = asConf(ops.holiday_hours);
    expect(holiday.confidence).toBeGreaterThanOrEqual(0);
  });
});

// ─── llmInferred PENALTY ─────────────────────────────────────────────────────

describe('llmInferred() extra -0.15 penalty', () => {
  it('payments field has confidence 0.35 (0.5 llm - 0.15 inferred) when values exist', () => {
    const v3 = transformToV3(makeRaw({ profile: { payments: ['Cash', 'Visa'] } }), null, {
      businessName: 'Biz',
    }) as V3;
    const ops = v3.operations as V3;
    const payments = asConf(ops.payments);
    expect(payments.confidence).toBe(0.35);
    expect(payments.value).toEqual(['Cash', 'Visa']);
  });

  it('amenities field has confidence 0.35 when non-empty', () => {
    const v3 = transformToV3(makeRaw({ profile: { amenities: ['WiFi', 'Parking'] } }), null, {
      businessName: 'Biz',
    }) as V3;
    const ops = v3.operations as V3;
    const amenities = asConf(ops.amenities);
    expect(amenities.confidence).toBe(0.35);
  });

  it('languages_spoken has confidence 0.35 when non-empty', () => {
    const v3 = transformToV3(
      makeRaw({ profile: { languages_spoken: ['English', 'Spanish'] } }),
      null,
      { businessName: 'Biz' },
    ) as V3;
    const ops = v3.operations as V3;
    const langs = asConf(ops.languages_spoken);
    expect(langs.confidence).toBe(0.35);
    expect(langs.value).toEqual(['English', 'Spanish']);
  });

  it('accessibility field has confidence 0.35', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const ops = v3.operations as V3;
    const acc = asConf(ops.accessibility);
    expect(acc.confidence).toBe(0.35);
  });

  it('llmInferred with empty array: 0.5 - 0.15 = 0.35, no null penalty (array is never null)', () => {
    // payments = [] => value = [] (not null) => no null penalty => 0.5 - 0.15 = 0.35
    const v3 = transformToV3(makeRaw({ profile: { payments: [] } }), null, {
      businessName: 'Biz',
    }) as V3;
    const ops = v3.operations as V3;
    const payments = asConf(ops.payments);
    expect(payments.confidence).toBe(0.35);
    expect(payments.value).toEqual([]);
  });
});

// ─── getCorroborationBoost ────────────────────────────────────────────────────

describe('getCorroborationBoost via mergeConf', () => {
  it('1 unique source kind => 0 boost', () => {
    // LLM phone only (no user/places) => single llm_generated kind
    const v3 = transformToV3(makeRaw({ profile: { phone: '+10001112222' } }), null, {
      businessName: 'Biz',
    }) as V3;
    const id = v3.identity as V3;
    const phone = asConf(id.phone);
    // Only llm_generated kind => no corroboration boost
    expect(phone.confidence).toBe(0.5); // 0.5 base, no penalty (non-null), no boost
  });

  it('2 unique source kinds => +0.08 boost', () => {
    // llm_generated (from profile.phone) + user_provided (from businessPhone)
    const v3 = transformToV3(makeRaw({ profile: { phone: '+10001112222' } }), null, {
      businessName: 'Biz',
      businessPhone: '+10001112222',
    }) as V3;
    const id = v3.identity as V3;
    const phone = asConf(id.phone);
    // user_provided base=0.9; merged with llm=0.5; primary=user_provided(0.9); 2 kinds => +0.08 => 0.98
    expect(phone.confidence).toBe(0.98);
    const kinds = phone.sources.map((s) => s.kind);
    expect(kinds).toContain('llm_generated');
    expect(kinds).toContain('user_provided');
  });

  it('3 unique source kinds => +0.15 boost', () => {
    // llm_generated + user_provided + google_places = 3 distinct kinds
    const places = makePlaces({ phone: '+19995550001' });
    const v3 = transformToV3(makeRaw({ profile: { phone: '+10001112222' } }), places, {
      businessName: 'Biz',
      businessPhone: '+10001112222',
    }) as V3;
    const id = v3.identity as V3;
    const phone = asConf(id.phone);
    // google_places base=0.92 (highest); 3 kinds => +0.15 => min(0.98, 0.92+0.15=1.07) => 0.98
    expect(phone.confidence).toBe(0.98);
    const kinds = phone.sources.map((s) => s.kind);
    expect(new Set(kinds).size).toBe(3);
  });

  it('corroboration boost is capped at 0.98', () => {
    // Website: llm_generated + google_places = 2 kinds => 0.92 + 0.08 = 1.0 => capped at 0.98
    const places = makePlaces({ website: 'https://example.com' });
    const v3 = transformToV3(
      makeRaw({
        profile: { website_url: 'https://example.com' },
        social: { website_url: 'https://example.com' },
      }),
      places,
      { businessName: 'Biz' },
    ) as V3;
    const id = v3.identity as V3;
    const website = asConf(id.website_url);
    // Never exceeds 0.98 regardless of source count
    expect(website.confidence).toBeLessThanOrEqual(0.98);
  });

  it('mergeConf deduplicates sources with same kind+id', () => {
    const v3 = transformToV3(
      makeRaw({
        profile: {
          address: { street: '1 Main', city: 'NYC', state: 'NY', zip: '10001', country: 'US' },
        },
      }),
      null,
      { businessName: 'Biz', businessAddress: '1 Main, NYC' },
    ) as V3;
    const id = v3.identity as V3;
    const addr = asConf(id.address);
    // Sources should be deduped by kind:id key
    const seenKeys = new Set(addr.sources.map((s) => `${s.kind}:${s.id ?? ''}`));
    expect(seenKeys.size).toBe(addr.sources.length);
  });
});

// ─── isImageRelevant filtering ────────────────────────────────────────────────

describe('isImageRelevant() filtering via transformToV3 media section', () => {
  it('includes image that mentions the business name in alt text', () => {
    const raw = makeRaw({
      profile: { business_type: 'barber' },
      images: {
        hero_images: [
          { concept: 'Custom Business Name shot', alt_text: 'Custom Business Name photo' },
          { concept: 'totally irrelevant', alt_text: 'totally irrelevant widget factory' },
        ],
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Custom Business Name' }) as V3;
    const media = v3.media as V3;
    const heroes = asConf(media.hero_images).value as Array<{ alt_text: string; concept: string }>;
    // First image references business name => included
    expect(
      heroes.some(
        (h) =>
          h.alt_text === 'Custom Business Name photo' || h.concept.includes('Custom Business Name'),
      ),
    ).toBe(true);
  });

  it('includes image with generic terms like "exterior" regardless of business type', () => {
    const raw = makeRaw({
      profile: { business_type: 'dentist' },
      images: {
        hero_images: [{ concept: 'shop exterior view', alt_text: 'exterior of building' }],
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Smile Clinic' }) as V3;
    const media = v3.media as V3;
    const heroes = asConf(media.hero_images).value as Array<{ concept: string }>;
    expect(heroes.length).toBe(1);
  });

  it('includes image with empty alt text (no filtering for empty)', () => {
    const raw = makeRaw({
      profile: { business_type: 'restaurant' },
      images: {
        hero_images: [{ concept: '', alt_text: '' }],
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'The Diner' }) as V3;
    const media = v3.media as V3;
    const heroes = asConf(media.hero_images).value as unknown[];
    // Empty alt text => included (pass-through)
    expect(heroes.length).toBe(1);
  });

  it('includes image matching business-type keyword for known type', () => {
    const raw = makeRaw({
      profile: { business_type: 'barber' },
      images: {
        hero_images: [{ concept: 'haircut session', alt_text: 'barber cutting hair' }],
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Clip Shop' }) as V3;
    const media = v3.media as V3;
    const heroes = asConf(media.hero_images).value as unknown[];
    expect(heroes.length).toBe(1);
  });

  it('excludes image that is irrelevant for known business type', () => {
    const raw = makeRaw({
      profile: { business_type: 'barber' },
      images: {
        // concept is "plumbing pipe leak" -- irrelevant to barber
        hero_images: [
          { concept: 'plumbing pipe leak repair', alt_text: 'plumbing pipe leak repair' },
        ],
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'The Barber' }) as V3;
    const media = v3.media as V3;
    const heroes = asConf(media.hero_images).value as unknown[];
    // "plumbing pipe leak repair" does not match barber keywords AND does not match generic terms
    // and does not contain business name "The Barber"
    expect(heroes.length).toBe(0);
  });

  it('includes all images for unknown business type (no filter applied)', () => {
    const raw = makeRaw({
      profile: { business_type: 'exotic_widget_factory' },
      images: {
        hero_images: [{ concept: 'anything goes here', alt_text: 'random description' }],
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Widget Co' }) as V3;
    const media = v3.media as V3;
    const heroes = asConf(media.hero_images).value as unknown[];
    // Unknown type => no filter => include all
    expect(heroes.length).toBe(1);
  });

  it('filters gallery photos from Google Places using isImageRelevant', () => {
    const places = makePlaces({
      photos: [
        { url: 'https://photo1.com', attribution: 'Google', width: 800, height: 600 },
        { url: 'https://photo2.com', attribution: 'Google', width: 800, height: 600 },
      ],
    });
    // Alt text for places photos is generated as "Photo of {businessName}"
    const v3 = transformToV3(makeRaw({ profile: { business_type: 'restaurant' } }), places, {
      businessName: 'Mama Mia Restaurant',
    }) as V3;
    const media = v3.media as V3;
    const gallery = asConf(media.gallery);
    // "Photo of Mama Mia Restaurant" contains business name => included
    expect(gallery.isPlaceholder).toBe(false);
    const photos = gallery.value as Array<{ source: string }>;
    expect(photos.length).toBe(2);
    expect(photos[0].source).toBe('google_places');
  });

  it('uses placeholder gallery when no photos pass filter', () => {
    // With no social google_business_photos and no places photos, gallery = placeholder
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const media = v3.media as V3;
    const gallery = asConf(media.gallery);
    expect(gallery.isPlaceholder).toBe(true);
    expect(gallery.value).toEqual([]);
  });

  it('gallery confidence reflects google_places source kind when places photos present', () => {
    const places = makePlaces({
      photos: [{ url: 'https://gp.com/1', attribution: 'Google', width: 400, height: 300 }],
    });
    const v3 = transformToV3(makeRaw(), places, { businessName: 'Biz' }) as V3;
    const media = v3.media as V3;
    const gallery = asConf(media.gallery);
    // First filtered photo source is 'google_places' => conf kind = 'google_places'
    expect(gallery.sources[0].kind).toBe('google_places');
  });
});

// ─── computeSectionConfidence ────────────────────────────────────────────────

describe('computeSectionConfidence() via provenance.sectionConfidence', () => {
  it('returns sectionConfidence for all 8 sections', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const prov = v3.provenance as V3;
    const sc = prov.sectionConfidence as Record<string, number>;
    for (const section of [
      'identity',
      'operations',
      'offerings',
      'trust',
      'brand',
      'marketing',
      'media',
      'seo',
    ]) {
      expect(typeof sc[section]).toBe('number');
      expect(sc[section]).toBeGreaterThanOrEqual(0);
      expect(sc[section]).toBeLessThanOrEqual(1);
    }
  });

  it('overallConfidence is the mean of sectionConfidence values', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const prov = v3.provenance as V3;
    const sc = prov.sectionConfidence as Record<string, number>;
    const vals = Object.values(sc);
    const expectedMean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    expect(prov.overallConfidence).toBe(expectedMean);
  });

  it('sectionConfidence values are always >= 0', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const prov = v3.provenance as V3;
    const sc = prov.sectionConfidence as Record<string, number>;
    for (const v of Object.values(sc)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('higher confidence data increases sectionConfidence', () => {
    const sparseProv = (transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3)
      .provenance as V3;
    const richRaw = makeRaw({
      profile: {
        phone: '+10001112222',
        email: 'rich@biz.com',
        business_name: 'Rich Biz',
        tagline: 'Best ever',
        description: 'A great business',
      },
    });
    const richProv = (transformToV3(richRaw, null, { businessName: 'Rich Biz' }) as V3)
      .provenance as V3;
    // Identity section with real values should score higher than sparse
    expect((richProv.sectionConfidence as Record<string, number>).identity).toBeGreaterThanOrEqual(
      (sparseProv.sectionConfidence as Record<string, number>).identity,
    );
  });
});

// ─── str / num / arr / strArr helpers (via field shape) ──────────────────────

describe('str() helper behaviour', () => {
  it('passes through non-empty string values', () => {
    const v3 = transformToV3(makeRaw({ profile: { tagline: 'A tagline' } }), null, {
      businessName: 'B',
    }) as V3;
    const tagline = asConf((v3.identity as V3).tagline);
    expect(tagline.value).toBe('A tagline');
  });

  it('returns null for number input', () => {
    // business_name given as a number => str returns null => falls back to userInputs.businessName
    const v3 = transformToV3(makeRaw({ profile: { business_name: 42 } }), null, {
      businessName: 'Fallback',
    }) as V3;
    const name = asConf((v3.identity as V3).business_name);
    expect(name.value).toBe('Fallback');
  });

  it('returns null for undefined/missing', () => {
    const v3 = transformToV3(makeRaw({ profile: {} }), null, { businessName: 'B' }) as V3;
    const email = asConf((v3.identity as V3).email);
    expect(email.value).toBeNull();
  });

  it('returns null for empty string', () => {
    const v3 = transformToV3(makeRaw({ profile: { email: '' } }), null, {
      businessName: 'B',
    }) as V3;
    const email = asConf((v3.identity as V3).email);
    expect(email.value).toBeNull();
  });
});

describe('num() helper behaviour', () => {
  it('passes through valid numbers', () => {
    const v3 = transformToV3(
      makeRaw({ profile: { services: [{ name: 'Svc', price_from: 99 }] } }),
      null,
      { businessName: 'B' },
    ) as V3;
    const offerings = v3.offerings as V3;
    const services = asConf(offerings.services).value as Array<V3>;
    expect(asConf(services[0].price_from).value).toBe(99);
  });

  it('returns null for NaN', () => {
    const v3 = transformToV3(
      makeRaw({ profile: { services: [{ name: 'Svc', price_from: NaN }] } }),
      null,
      { businessName: 'B' },
    ) as V3;
    const services = asConf((v3.offerings as V3).services).value as Array<V3>;
    expect(asConf(services[0].price_from).value).toBeNull();
  });

  it('returns null for string input', () => {
    const v3 = transformToV3(
      makeRaw({ profile: { services: [{ name: 'Svc', duration_minutes: 'thirty' }] } }),
      null,
      { businessName: 'B' },
    ) as V3;
    const services = asConf((v3.offerings as V3).services).value as Array<V3>;
    expect(asConf(services[0].duration_minutes).value).toBeNull();
  });
});

describe('arr() helper behaviour', () => {
  it('returns array when given an array', () => {
    const v3 = transformToV3(
      makeRaw({ profile: { faq: [{ question: 'Q?', answer: 'A.' }] } }),
      null,
      { businessName: 'B' },
    ) as V3;
    const faq = asConf((v3.offerings as V3).faq).value as Array<{ question: string }>;
    expect(Array.isArray(faq)).toBe(true);
    expect(faq[0].question).toBe('Q?');
  });

  it('returns empty array when given non-array', () => {
    const v3 = transformToV3(makeRaw({ profile: { services: 'not an array' } }), null, {
      businessName: 'B',
    }) as V3;
    const services = asConf((v3.offerings as V3).services).value as unknown[];
    expect(services).toEqual([]);
  });

  it('returns empty array when given null', () => {
    const v3 = transformToV3(makeRaw({ profile: { hours: null } }), null, {
      businessName: 'B',
    }) as V3;
    const hours = asConf((v3.operations as V3).hours).value as unknown[];
    expect(hours).toEqual([]);
  });
});

describe('strArr() helper behaviour', () => {
  it('filters out non-string items from mixed arrays', () => {
    const v3 = transformToV3(
      makeRaw({ profile: { categories: ['Barber', 42, null, 'Grooming'] } }),
      null,
      { businessName: 'B' },
    ) as V3;
    const cats = asConf((v3.identity as V3).categories).value as string[];
    expect(cats).toEqual(['Barber', 'Grooming']);
  });

  it('returns empty array for non-array input', () => {
    const v3 = transformToV3(makeRaw({ profile: { categories: 'single' } }), null, {
      businessName: 'B',
    }) as V3;
    const cats = asConf((v3.identity as V3).categories).value as string[];
    expect(cats).toEqual([]);
  });
});

// ─── Warning accumulation ─────────────────────────────────────────────────────

describe('warning accumulation', () => {
  it('warns about missing phone, email, website, geo, reviews, and booking URL', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const warnings = (v3.provenance as V3).warnings as string[];
    expect(warnings.some((w) => w.includes('phone'))).toBe(true);
    expect(warnings.some((w) => w.includes('email'))).toBe(true);
    expect(warnings.some((w) => w.includes('website'))).toBe(true);
    expect(warnings.some((w) => w.includes('geo'))).toBe(true);
    expect(warnings.some((w) => w.includes('review'))).toBe(true);
    expect(warnings.some((w) => w.includes('booking'))).toBe(true);
  });

  it('no phone warning when phone is provided via userInputs', () => {
    const v3 = transformToV3(makeRaw(), null, {
      businessName: 'Biz',
      businessPhone: '+10001112222',
    }) as V3;
    const warnings = (v3.provenance as V3).warnings as string[];
    expect(warnings.some((w) => w.includes('phone'))).toBe(false);
  });

  it('no geo warning when Google Places geo present', () => {
    const places = makePlaces({ geo: { lat: 40.0, lng: -74.0 } });
    const v3 = transformToV3(makeRaw(), places, { businessName: 'Biz' }) as V3;
    const warnings = (v3.provenance as V3).warnings as string[];
    expect(warnings.some((w) => w.includes('geo'))).toBe(false);
  });

  it('no review warning when reviews exist in profile', () => {
    const raw = makeRaw({
      profile: {
        reviews_summary: { aggregate_rating: 4.5, review_count: 30, featured_reviews: [] },
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const warnings = (v3.provenance as V3).warnings as string[];
    expect(warnings.some((w) => w.includes('review'))).toBe(false);
  });

  it('no booking warning when booking URL present', () => {
    const raw = makeRaw({ profile: { booking: { url: 'https://book.me' } } });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const warnings = (v3.provenance as V3).warnings as string[];
    expect(warnings.some((w) => w.includes('booking'))).toBe(false);
  });
});

// ─── placeholder() ───────────────────────────────────────────────────────────

describe('placeholder() values', () => {
  it('holiday_hours is a placeholder with empty array value', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const ops = v3.operations as V3;
    const holiday = asConf(ops.holiday_hours);
    expect(holiday.isPlaceholder).toBe(true);
    expect(holiday.value).toEqual([]);
    expect(holiday.sources[0].kind).toBe('internal_inference');
  });

  it('credentials is a placeholder', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const trust = v3.trust as V3;
    const creds = asConf(trust.credentials);
    expect(creds.isPlaceholder).toBe(true);
    expect(creds.value).toEqual([]);
  });

  it('before_after_gallery is a placeholder', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const trust = v3.trust as V3;
    const bef = asConf(trust.before_after_gallery);
    expect(bef.isPlaceholder).toBe(true);
    expect(bef.value).toEqual([]);
  });

  it('brand.tone is a placeholder with do/dont shape', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const brand = v3.brand as V3;
    const tone = asConf(brand.tone);
    expect(tone.isPlaceholder).toBe(true);
    expect(tone.value).toEqual({ do: [], dont: [] });
  });

  it('team_image is a placeholder', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const media = v3.media as V3;
    const teamImg = asConf(media.team_image);
    expect(teamImg.isPlaceholder).toBe(true);
  });

  it('placeholder strategy is internal_inference with css_gradient value', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const media = v3.media as V3;
    const strategy = asConf(media.placeholder_strategy);
    expect(strategy.value).toBe('css_gradient');
    expect(strategy.sources[0].kind).toBe('internal_inference');
  });

  it('seo.pages is a placeholder', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const seo = v3.seo as V3;
    const pages = asConf(seo.pages);
    expect(pages.isPlaceholder).toBe(true);
    expect(pages.value).toEqual({});
  });

  it('team headshot_url is placeholder with null value', () => {
    const raw = makeRaw({
      profile: { team: [{ name: 'Alex', role: 'Owner' }] },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const trust = v3.trust as V3;
    const team = asConf(trust.team).value as Array<V3>;
    const headshot = asConf(team[0].headshot_url);
    expect(headshot.isPlaceholder).toBe(true);
    expect(headshot.value).toBeNull();
  });
});

// ─── Brand section defaults ───────────────────────────────────────────────────

describe('brand section defaults', () => {
  it('uses default colors when brand.colors is absent', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const brand = v3.brand as V3;
    const colors = asConf(brand.colors).value as Record<string, string>;
    expect(colors.primary).toBe('#2563eb');
    expect(colors.secondary).toBe('#7c3aed');
    expect(colors.accent).toBe('#64ffda');
  });

  it('uses provided colors when present', () => {
    const raw = makeRaw({
      brand: {
        colors: {
          primary: '#ff0000',
          secondary: '#00ff00',
          accent: '#0000ff',
          background: '#fff',
          surface: '#eee',
          text_primary: '#000',
          text_secondary: '#888',
        },
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const brand = v3.brand as V3;
    const colors = asConf(brand.colors).value as Record<string, string>;
    expect(colors.primary).toBe('#ff0000');
    expect(colors.accent).toBe('#0000ff');
  });

  it('uses businessName as fallback_design.text when not provided', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'My Biz' }) as V3;
    const brand = v3.brand as V3;
    const logo = asConf(brand.logo).value as Record<string, unknown>;
    const fd = logo.fallback_design as Record<string, string>;
    expect(fd.text).toBe('My Biz');
  });

  it('uses default fonts when brand.fonts absent', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const brand = v3.brand as V3;
    const fonts = asConf(brand.fonts).value as Record<string, string>;
    expect(fonts.heading).toBe('Inter');
    expect(fonts.body).toBe('Inter');
  });
});

// ─── SEO section ─────────────────────────────────────────────────────────────

describe('SEO section', () => {
  it('uses seo.title from nested seo object in profile', () => {
    const raw = makeRaw({
      profile: {
        seo: {
          title: 'Custom SEO Title',
          description: 'SEO desc',
          primary_keywords: ['kw'],
          secondary_keywords: [],
          service_keywords: [],
          neighborhood_keywords: [],
        },
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const seo = v3.seo as V3;
    expect(asConf(seo.title).value).toBe('Custom SEO Title');
  });

  it('falls back to businessName for SEO title when absent', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'My Business' }) as V3;
    const seo = v3.seo as V3;
    expect(asConf(seo.title).value).toBe('My Business');
  });

  it('schema_org aggregateRating is undefined when no reviews', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const seo = v3.seo as V3;
    const schema = asConf(seo.schema_org).value as Record<string, unknown>;
    expect(schema.aggregateRating).toBeUndefined();
  });

  it('schema_org aggregateRating is set when reviews present', () => {
    const raw = makeRaw({
      profile: {
        reviews_summary: { aggregate_rating: 4.7, review_count: 55, featured_reviews: [] },
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const seo = v3.seo as V3;
    const schema = asConf(seo.schema_org).value as Record<string, unknown>;
    expect(schema.aggregateRating).toEqual({ ratingValue: 4.7, reviewCount: 55 });
  });

  it('schema_org priceRange uses first service price_hint', () => {
    const raw = makeRaw({
      profile: { services: [{ name: 'Cut', price_hint: '$20-$50' }] },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const seo = v3.seo as V3;
    const schema = asConf(seo.schema_org).value as Record<string, unknown>;
    expect(schema.priceRange).toBe('$20-$50');
  });

  it('schema_org sameAs collects social link URLs', () => {
    const raw = makeRaw({
      social: {
        social_links: [{ platform: 'facebook', url: 'https://fb.com/test', confidence: 0.8 }],
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const seo = v3.seo as V3;
    const schema = asConf(seo.schema_org).value as Record<string, unknown>;
    expect((schema.sameAs as string[]).includes('https://fb.com/test')).toBe(true);
  });
});

// ─── Google Places enrichment paths ──────────────────────────────────────────

describe('Google Places enrichment paths', () => {
  it('merges Google Places website into websiteConf', () => {
    const places = makePlaces({ website: 'https://places-site.com' });
    const v3 = transformToV3(makeRaw(), places, { businessName: 'Biz' }) as V3;
    const id = v3.identity as V3;
    const website = asConf(id.website_url);
    expect(website.value).toBe('https://places-site.com');
    expect(website.sources.some((s) => s.kind === 'google_places')).toBe(true);
  });

  it('merges Google Places hours into hoursConf', () => {
    const places = makePlaces({
      hours: [{ day: 'Wednesday', open: '11:00 AM', close: '8:00 PM', closed: false }],
    });
    const v3 = transformToV3(makeRaw(), places, { businessName: 'Biz' }) as V3;
    const ops = v3.operations as V3;
    const hours = asConf(ops.hours);
    expect(hours.sources.some((s) => s.kind === 'google_places')).toBe(true);
  });

  it('merges Google Places reviews via rating or reviews length', () => {
    const places = makePlaces({
      rating: 4.8,
      review_count: 300,
      reviews: [{ text: 'Great place!', author: 'Alice', rating: 5, time: '1 week ago' }],
    });
    const v3 = transformToV3(makeRaw(), places, { businessName: 'Biz' }) as V3;
    const trust = v3.trust as V3;
    const reviews = asConf(trust.reviews);
    const val = reviews.value as {
      aggregate: { rating: number; count: number };
      featured: Array<{ quote: string }>;
    };
    expect(val.aggregate.rating).toBe(4.8);
    expect(val.aggregate.count).toBe(300);
    expect(val.featured[0].quote).toBe('Great place!');
  });

  it('truncates reviews text to 200 chars', () => {
    const longText = 'x'.repeat(250);
    const places = makePlaces({
      rating: 4.0,
      reviews: [{ text: longText, author: 'Bob', rating: 4, time: '3 weeks ago' }],
    });
    const v3 = transformToV3(makeRaw(), places, { businessName: 'Biz' }) as V3;
    const trust = v3.trust as V3;
    const reviews = asConf(trust.reviews);
    const val = reviews.value as { featured: Array<{ quote: string }> };
    expect(val.featured[0].quote.length).toBe(200);
  });

  it('googleConf merges place_id from Google Places', () => {
    const places = makePlaces({ place_id: 'GPLACES-XYZ' });
    const v3 = transformToV3(makeRaw(), places, { businessName: 'Biz' }) as V3;
    const id = v3.identity as V3;
    const google = asConf(id.google);
    const val = google.value as { place_id: string };
    expect(val.place_id).toBe('GPLACES-XYZ');
    expect(google.sources.some((s) => s.kind === 'google_places' && s.id === 'GPLACES-XYZ')).toBe(
      true,
    );
  });
});

// ─── storefront_image branch ──────────────────────────────────────────────────

describe('storefront_image handling', () => {
  it('is llm-wrapped when storefront_image is an object', () => {
    const raw = makeRaw({
      images: {
        storefront_image: {
          url: 'https://front.example.com/shop.jpg',
          search_query: 'barber shop front',
        },
      },
    });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const media = v3.media as V3;
    const sf = asConf(media.storefront_image);
    expect(sf.isPlaceholder).toBe(false);
    expect((sf.value as Record<string, unknown>).url).toBe('https://front.example.com/shop.jpg');
  });

  it('is a placeholder when storefront_image is absent', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const media = v3.media as V3;
    const sf = asConf(media.storefront_image);
    expect(sf.isPlaceholder).toBe(true);
    expect((sf.value as Record<string, unknown>).source).toBe('css_placeholder');
  });
});

// ─── geo / service_area edge cases ───────────────────────────────────────────

describe('geo and service_area edge cases', () => {
  it('geo value is null when profile.geo is not an object', () => {
    const raw = makeRaw({ profile: { geo: 'not-an-object' } });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const id = v3.identity as V3;
    expect(asConf(id.geo).value).toBeNull();
  });

  it('service_area defaults to empty zips/towns when not an object', () => {
    const raw = makeRaw({ profile: { service_area: 'invalid' } });
    const v3 = transformToV3(raw, null, { businessName: 'Biz' }) as V3;
    const id = v3.identity as V3;
    const sa = asConf(id.service_area).value as { zips: string[]; towns: string[] };
    expect(sa.zips).toEqual([]);
    expect(sa.towns).toEqual([]);
  });
});

// ─── uiPolicy thresholds ──────────────────────────────────────────────────────

describe('uiPolicy thresholds completeness', () => {
  it('all expected component threshold keys are present', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const ui = (v3.uiPolicy as V3).componentThresholds as Record<string, number>;
    const expected = [
      'hero.title',
      'hero.tagline',
      'contact.phone',
      'contact.booking_cta',
      'contact.address',
      'contact.map',
      'hours.display',
      'reviews.aggregate',
      'services.pricing',
      'team.bios',
      'brand.colors',
      'brand.fonts',
      'marketing.copy',
      'images.hero',
      'images.gallery',
    ];
    for (const key of expected) {
      // Use hasOwnProperty because keys like "hero.title" are flat strings
      // (not nested paths); toHaveProperty() interprets dots as path separators.
      expect(Object.prototype.hasOwnProperty.call(ui, key)).toBe(true);
      expect(typeof ui[key]).toBe('number');
    }
  });

  it('prominenceLevels has expected keys', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const ui = v3.uiPolicy as V3;
    const pl = ui.prominenceLevels as Record<string, string>;
    expect(pl).toHaveProperty('prominent');
    expect(pl).toHaveProperty('standard');
    expect(pl).toHaveProperty('deemphasize');
    expect(pl).toHaveProperty('hide_or_placeholder');
  });
});

// ─── enrichmentPipeline ───────────────────────────────────────────────────────

describe('enrichmentPipeline', () => {
  it('contains only llm_research without places', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    expect((v3.provenance as V3).enrichmentPipeline).toEqual(['llm_research']);
  });

  it('contains both llm_research and google_places with places data', () => {
    const v3 = transformToV3(makeRaw(), makePlaces(), { businessName: 'Biz' }) as V3;
    expect((v3.provenance as V3).enrichmentPipeline).toEqual(['llm_research', 'google_places']);
  });
});

// ─── provenance.generatedAt ───────────────────────────────────────────────────

describe('provenance.generatedAt', () => {
  it('is a valid ISO-8601 string', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    const generatedAt = (v3.provenance as V3).generatedAt as string;
    expect(typeof generatedAt).toBe('string');
    expect(new Date(generatedAt).toISOString()).toBe(generatedAt);
  });

  it('version is v3', () => {
    const v3 = transformToV3(makeRaw(), null, { businessName: 'Biz' }) as V3;
    expect((v3.provenance as V3).version).toBe('v3');
  });
});
