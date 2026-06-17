/**
 * site_gen_context — pure assembly/merge of all generation inputs into a single
 * typed, Zod-validated GenerationContext.
 *
 * Precedence (later wins per key):
 *   leadResearch < placesData < createForm < edits
 *
 * brand is merged separately (passed through).
 * seoKeywords are deduped + lowercased.
 * sources lists which input keys were non-empty.
 */

import { assembleGenerationContext } from '../services/site_gen_context';

// ---------------------------------------------------------------------------
// Test 1 — edits beats createForm beats placesData beats leadResearch
// ---------------------------------------------------------------------------
describe('assembleGenerationContext — business field precedence', () => {
  it('edits override createForm which override placesData which override leadResearch for a shared key', () => {
    const ctx = assembleGenerationContext({
      leadResearch: { name: 'from-lead', city: 'Newark' },
      placesData: { name: 'from-places' },
      createForm: { name: 'from-form' },
      edits: { name: 'from-edits' },
    });

    // edits wins overall
    expect(ctx.business['name']).toBe('from-edits');
    // keys unique to a lower-precedence layer survive
    expect(ctx.business['city']).toBe('Newark');
  });

  it('createForm overrides placesData and leadResearch when edits is absent', () => {
    const ctx = assembleGenerationContext({
      leadResearch: { name: 'lead' },
      placesData: { name: 'places' },
      createForm: { name: 'form' },
    });

    expect(ctx.business['name']).toBe('form');
  });

  it('placesData overrides leadResearch when createForm and edits are absent', () => {
    const ctx = assembleGenerationContext({
      leadResearch: { name: 'lead', extra: true },
      placesData: { name: 'places' },
    });

    expect(ctx.business['name']).toBe('places');
    expect(ctx.business['extra']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — brand passes through independently
// ---------------------------------------------------------------------------
describe('assembleGenerationContext — brand', () => {
  it('brand is merged into context without being overridden by business fields', () => {
    const ctx = assembleGenerationContext({
      createForm: { primaryColor: 'blue' },
      brand: { primaryColor: '#00e5ff', font: 'Inter' },
    });

    // brand is a separate top-level field, not mixed into business
    expect(ctx.brand['primaryColor']).toBe('#00e5ff');
    expect(ctx.brand['font']).toBe('Inter');
    // business only has fields from createForm (not brand)
    expect(ctx.business['primaryColor']).toBe('blue');
  });

  it('brand defaults to an empty object when not provided', () => {
    const ctx = assembleGenerationContext({ createForm: { title: 'Acme' } });
    expect(ctx.brand).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Test 3 — seoKeywords deduped + lowercased
// ---------------------------------------------------------------------------
describe('assembleGenerationContext — seoKeywords', () => {
  it('deduplicates and lowercases seoKeywords', () => {
    const ctx = assembleGenerationContext({
      seoKeywords: ['SEO', 'seo', 'New York', 'new york', 'PIZZA'],
    });

    expect(ctx.seoKeywords).toEqual(['seo', 'new york', 'pizza']);
  });

  it('returns an empty array when seoKeywords is not provided', () => {
    const ctx = assembleGenerationContext({});
    expect(ctx.seoKeywords).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — sources reflects which input keys were present (non-empty)
// ---------------------------------------------------------------------------
describe('assembleGenerationContext — sources', () => {
  it('lists only the input keys that were provided', () => {
    const ctx = assembleGenerationContext({
      leadResearch: { name: 'Acme' },
      createForm: { phone: '555-1234' },
      // placesData, edits, brand, seoKeywords omitted
    });

    expect(ctx.sources).toContain('leadResearch');
    expect(ctx.sources).toContain('createForm');
    expect(ctx.sources).not.toContain('placesData');
    expect(ctx.sources).not.toContain('edits');
  });

  it('includes brand and seoKeywords in sources when they are provided', () => {
    const ctx = assembleGenerationContext({
      brand: { logo: 'url' },
      seoKeywords: ['pizza'],
    });

    expect(ctx.sources).toContain('brand');
    expect(ctx.sources).toContain('seoKeywords');
    expect(ctx.sources).not.toContain('leadResearch');
  });
});

// ---------------------------------------------------------------------------
// Test 5 — empty input produces a valid, empty-but-valid context
// ---------------------------------------------------------------------------
describe('assembleGenerationContext — empty input', () => {
  it('returns empty-but-valid GenerationContext when no inputs are provided', () => {
    const ctx = assembleGenerationContext({});

    expect(ctx.business).toEqual({});
    expect(ctx.brand).toEqual({});
    expect(ctx.seoKeywords).toEqual([]);
    expect(ctx.sources).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — output is Zod-validated (schema rejects bad shapes at runtime)
// ---------------------------------------------------------------------------
describe('assembleGenerationContext — Zod validation', () => {
  it('returns a well-typed GenerationContext with all required fields', () => {
    const ctx = assembleGenerationContext({
      leadResearch: { industry: 'food' },
      seoKeywords: ['Pizza', 'Newark'],
    });

    // All four required top-level fields are present
    expect(typeof ctx.business).toBe('object');
    expect(typeof ctx.brand).toBe('object');
    expect(Array.isArray(ctx.seoKeywords)).toBe(true);
    expect(Array.isArray(ctx.sources)).toBe(true);
  });
});
