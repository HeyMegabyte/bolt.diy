import { computeContextReadiness } from '../services/context_readiness';

/**
 * AI context-quality axis (item #3) — the readiness GATE. Before any AI
 * generation fires, score whether the context window is sufficiently loaded
 * (required slots filled × retrieval hits × confidence). Below threshold the
 * caller BLOCKS generation and fetches the gaps first — "no generation on thin
 * context". Pure + total (never throws); invalid input → score 0, not-ready.
 */

describe('computeContextReadiness', () => {
  const full = {
    requiredSlots: ['brand', 'sitemap', 'competitors'],
    filledSlots: ['brand', 'sitemap', 'competitors'],
    retrievalHits: 10,
    retrievalExpected: 10,
    avgConfidence: 1,
  };

  it('scores a fully-loaded context 100 and ready=true', () => {
    const r = computeContextReadiness(full);
    expect(r.score).toBe(100);
    expect(r.ready).toBe(true);
    expect(r.missingSlots).toEqual([]);
  });

  it('is NOT ready when a required slot is missing, even with high retrieval+confidence', () => {
    const r = computeContextReadiness({ ...full, filledSlots: ['brand', 'sitemap'] });
    expect(r.ready).toBe(false);
    expect(r.missingSlots).toEqual(['competitors']);
    expect(r.reasons.some((x) => x.includes('competitors'))).toBe(true);
  });

  it('blocks (ready=false) when the score is below the default threshold of 70', () => {
    const r = computeContextReadiness({
      requiredSlots: ['brand', 'sitemap'],
      filledSlots: ['brand', 'sitemap'],
      retrievalHits: 0,
      retrievalExpected: 10,
      avgConfidence: 0.1,
    });
    // slots 50% (full) + retrieval 0 + confidence ~2% → ~52 < 70
    expect(r.score).toBeLessThan(70);
    expect(r.ready).toBe(false);
  });

  it('honors a custom threshold', () => {
    const input = {
      requiredSlots: ['brand'],
      filledSlots: ['brand'],
      retrievalHits: 5,
      retrievalExpected: 10,
      avgConfidence: 0.5,
    };
    // slots 50 + retrieval 15 + confidence 10 = 75
    expect(computeContextReadiness(input).score).toBe(75);
    expect(computeContextReadiness(input, { threshold: 80 }).ready).toBe(false);
    expect(computeContextReadiness(input, { threshold: 70 }).ready).toBe(true);
  });

  it('treats an empty required-slot set as fully-satisfied on the slot axis', () => {
    const r = computeContextReadiness({
      requiredSlots: [],
      filledSlots: [],
      retrievalHits: 10,
      retrievalExpected: 10,
      avgConfidence: 1,
    });
    expect(r.score).toBe(100);
    expect(r.missingSlots).toEqual([]);
  });

  it('clamps retrieval ratio at 1 (over-retrieval never scores >100)', () => {
    const r = computeContextReadiness({ ...full, retrievalHits: 999, retrievalExpected: 10 });
    expect(r.score).toBe(100);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it('returns score 0 + not-ready + a reason on invalid input, never throws', () => {
    const r = computeContextReadiness({ requiredSlots: 'nope' } as unknown as never);
    expect(r.score).toBe(0);
    expect(r.ready).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('handles retrievalExpected=0 as a satisfied retrieval axis (nothing to retrieve)', () => {
    const r = computeContextReadiness({
      requiredSlots: ['brand'],
      filledSlots: ['brand'],
      retrievalHits: 0,
      retrievalExpected: 0,
      avgConfidence: 1,
    });
    expect(r.score).toBe(100);
  });
});
