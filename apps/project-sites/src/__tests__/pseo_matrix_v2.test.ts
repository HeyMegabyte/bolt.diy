/**
 * @module __tests__/pseo_matrix_v2
 * @description Unit tests for pSEO Matrix v2 schemas + pure helpers (feature #29).
 */

import {
  axisComboHash,
  comboToSlug,
  computeUniqueDataPct,
  PseoAxisSchema,
  PseoGenerateRequestSchema,
  UNIQUE_DATA_FLOOR_PCT,
  MAX_PAGES_PER_AXIS,
} from '../../libs/features/pseo_matrix/feature.schemas.js';

describe('pseo_matrix_v2 schemas', () => {
  it('UNIQUE_DATA_FLOOR_PCT is 40 (post-March-2026 floor)', () => {
    expect(UNIQUE_DATA_FLOOR_PCT).toBe(40);
  });

  it('caps axes at 200 values per axis', () => {
    expect(MAX_PAGES_PER_AXIS).toBe(200);
    const tooMany = { axisName: 'city', values: new Array(201).fill('x') };
    expect(PseoAxisSchema.safeParse(tooMany).success).toBe(false);
  });

  it('rejects malformed axis names', () => {
    expect(PseoAxisSchema.safeParse({ axisName: 'BadName', values: ['x'] }).success).toBe(false);
    expect(PseoAxisSchema.safeParse({ axisName: 'good_name', values: ['x'] }).success).toBe(true);
  });

  it('PseoGenerateRequest requires >=1 axis', () => {
    expect(PseoGenerateRequestSchema.safeParse({ axes: [] }).success).toBe(false);
    expect(
      PseoGenerateRequestSchema.safeParse({
        axes: [{ axisName: 'task', values: ['x'], cap: 1 }],
      }).success,
    ).toBe(true);
  });

  it('axisComboHash is deterministic regardless of key order', () => {
    const a = axisComboHash({ city: 'Newark', task: 'book-now' });
    const b = axisComboHash({ task: 'book-now', city: 'Newark' });
    expect(a).toBe(b);
  });

  it('axisComboHash distinguishes different combos', () => {
    expect(axisComboHash({ city: 'Newark' })).not.toBe(axisComboHash({ city: 'Trenton' }));
  });

  it('comboToSlug builds clean kebab paths', () => {
    expect(comboToSlug({ task: 'Book Now', city: 'Newark NJ' })).toBe('/tasks/book-now/newark-nj');
    expect(comboToSlug({ city: 'New York City' }, '/c')).toBe('/c/new-york-city');
  });

  it('computeUniqueDataPct returns 0 for empty content', () => {
    expect(
      computeUniqueDataPct({ googlePlaces: 0, reviews: 0, pricing: 0, other: 0 }, 0),
    ).toBe(0);
  });

  it('computeUniqueDataPct passes 40% floor with enough real-data points', () => {
    // 4 places (100pts) + 4 reviews (60pts) + 2 pricing (40pts) = 200 source pts
    // wordCount 500 → 200/500 = 40% exactly.
    const pct = computeUniqueDataPct(
      { googlePlaces: 4, reviews: 4, pricing: 2, other: 0 },
      500,
    );
    expect(pct).toBeGreaterThanOrEqual(40);
  });

  it('computeUniqueDataPct flags below-floor for keyword-only content', () => {
    // Zero real-data points + 1000 word count → 0%
    const pct = computeUniqueDataPct(
      { googlePlaces: 0, reviews: 0, pricing: 0, other: 0 },
      1000,
    );
    expect(pct).toBe(0);
    expect(pct).toBeLessThan(UNIQUE_DATA_FLOOR_PCT);
  });

  it('computeUniqueDataPct clamps at 100', () => {
    const pct = computeUniqueDataPct(
      { googlePlaces: 100, reviews: 100, pricing: 100, other: 100 },
      100,
    );
    expect(pct).toBe(100);
  });
});
