import { geoSchema, addressSchema, smallBizSeedV3Schema } from '../schemas/seed-v3.js';

/**
 * Coverage for the SmallBizSeedV3 seed payload schema (seed-v3.ts) — previously
 * a zero-test exported module. The schema confidence-wraps every field
 * (`{ value, confidence, sources[≥1] }`), so we test the wrapper contract on a
 * couple of leaf sub-schemas + that the deeply-nested root rejects incomplete
 * input (a full valid fixture would be brittle; the root's required-keys gate
 * is the contract that matters).
 */

/** Build a valid confidence-wrapped value: `{ value, confidence, sources[≥1] }`. */
function conf<T>(value: T) {
  return {
    value,
    confidence: 0.9,
    sources: [{ kind: 'business_owner' as const, retrievedAt: '2026-01-01T00:00:00Z' }],
  };
}

describe('confidence-wrapped leaf schemas', () => {
  it('geoSchema accepts conf-wrapped lat/lng', () => {
    expect(geoSchema.safeParse({ lat: conf(37.77), lng: conf(-122.41) }).success).toBe(true);
  });

  it('geoSchema rejects a wrapper missing sources (sources requires ≥1)', () => {
    expect(geoSchema.safeParse({ lat: { value: 1, confidence: 0.9, sources: [] }, lng: conf(2) }).success).toBe(false);
  });

  it('geoSchema rejects a confidence outside 0-1', () => {
    expect(
      geoSchema.safeParse({
        lat: { value: 1, confidence: 1.5, sources: [{ kind: 'business_owner', retrievedAt: 't' }] },
        lng: conf(2),
      }).success,
    ).toBe(false);
  });

  it('geoSchema rejects a non-number value inside the wrapper', () => {
    expect(geoSchema.safeParse({ lat: conf('north'), lng: conf(2) }).success).toBe(false);
  });

  it('addressSchema accepts five conf-wrapped string parts', () => {
    expect(
      addressSchema.safeParse({
        street: conf('1 Main St'), city: conf('SF'), state: conf('CA'),
        zip: conf('94016'), country: conf('US'),
      }).success,
    ).toBe(true);
  });

  it('addressSchema rejects a missing required part (zip)', () => {
    expect(
      addressSchema.safeParse({ street: conf('1 Main St'), city: conf('SF'), state: conf('CA'), country: conf('US') }).success,
    ).toBe(false);
  });
});

describe('smallBizSeedV3Schema (root) required-keys gate', () => {
  it('rejects an empty payload', () => {
    expect(smallBizSeedV3Schema.safeParse({}).success).toBe(false);
  });

  it('rejects a payload missing top-level sections', () => {
    // identity present but the other 9 required sections absent.
    expect(smallBizSeedV3Schema.safeParse({ identity: {} }).success).toBe(false);
  });

  it('surfaces issues for every missing top-level section', () => {
    const res = smallBizSeedV3Schema.safeParse({});
    expect(res.success).toBe(false);
    if (!res.success) {
      const keys = new Set(res.error.issues.map((i) => i.path[0]));
      // all 10 required sections should be flagged
      for (const k of ['identity', 'operations', 'offerings', 'trust', 'brand', 'marketing', 'media', 'seo', 'uiPolicy', 'provenance']) {
        expect(keys.has(k)).toBe(true);
      }
    }
  });
});
