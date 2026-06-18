import { prepareContext } from '../services/context_prepare';

/**
 * AI context-quality axis — the CAPSTONE composer. Ties the 4 pure primitives
 * (assembleLabeledContext + buildContextManifest + computeContextReadiness) into
 * the single call the generation pipeline makes: returns the labeled context to
 * send, its trace manifest/hash, the readiness verdict, and the go/no-go `ready`
 * flag. Pure + total; never throws.
 */

describe('prepareContext', () => {
  const base = {
    sections: {
      system: 'You build SMB websites.',
      retrievedFacts: ['Open 9-5', 'Newark NJ'],
      brand: 'cyan/black',
    },
    readiness: {
      requiredSlots: ['brand', 'facts'],
      filledSlots: ['brand', 'facts'],
      retrievalHits: 10,
      retrievalExpected: 10,
      avgConfidence: 1,
    },
  };

  it('returns the assembled labeled context', () => {
    const r = prepareContext(base);
    expect(r.context).toContain('=== SYSTEM ===');
    expect(r.context).toContain('=== RETRIEVED_FACTS ===');
    expect(r.context).toContain('- Open 9-5');
  });

  it('returns a manifest with a stable hash + total chars matching the context length', () => {
    const r = prepareContext(base);
    expect(r.manifest.hash).toMatch(/^[0-9a-f]{8,}$/);
    expect(r.manifest.totalChars).toBeGreaterThan(0);
    expect(r.manifest.sections.length).toBeGreaterThan(0);
  });

  it('gates: ready=true when fully loaded', () => {
    const r = prepareContext(base);
    expect(r.ready).toBe(true);
    expect(r.readiness.ready).toBe(true);
  });

  it('gates: ready=false (block generation) when a required slot is missing', () => {
    const r = prepareContext({
      ...base,
      readiness: { ...base.readiness, filledSlots: ['brand'] },
    });
    expect(r.ready).toBe(false);
    expect(r.readiness.missingSlots).toEqual(['facts']);
  });

  it('honors a custom readiness threshold', () => {
    const thin = {
      sections: { system: 'x' },
      readiness: {
        requiredSlots: ['brand'],
        filledSlots: ['brand'],
        retrievalHits: 5,
        retrievalExpected: 10,
        avgConfidence: 0.5,
      },
    };
    expect(prepareContext({ ...thin, threshold: 80 }).ready).toBe(false);
    expect(prepareContext({ ...thin, threshold: 70 }).ready).toBe(true);
  });

  it('is deterministic — same input → same context + same manifest hash', () => {
    expect(prepareContext(base).manifest.hash).toBe(prepareContext(base).manifest.hash);
    expect(prepareContext(base).context).toBe(prepareContext(base).context);
  });

  it('never throws on empty/junk input', () => {
    const r = prepareContext({ sections: {}, readiness: {} as never });
    expect(r.context).toBe('');
    expect(r.ready).toBe(false);
    expect(typeof r.manifest.hash).toBe('string');
  });
});
