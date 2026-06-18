import { buildContextManifest } from '../services/context_manifest';

/**
 * AI context-quality axis (item #5, the PURE half) — build a hashable manifest of
 * the assembled context (per-section sizes + a stable content hash) so every
 * generation trace records EXACTLY what the model saw. The logging (PostHog /
 * AI Gateway) is the separate I/O half. Pure + total; deterministic; never throws.
 */

describe('buildContextManifest', () => {
  it('reports per-section char counts + total + a hash', () => {
    const m = buildContextManifest({ brand: 'cyan', facts: 'open 9-5' });
    expect(m.sections).toEqual([
      { name: 'brand', chars: 4, hash: expect.any(String) },
      { name: 'facts', chars: 8, hash: expect.any(String) },
    ]);
    expect(m.totalChars).toBe(12);
    expect(m.hash).toMatch(/^[0-9a-f]{8,}$/);
  });

  it('is deterministic — same input → same hash', () => {
    const a = buildContextManifest({ s: 'hello world' });
    const b = buildContextManifest({ s: 'hello world' });
    expect(a.hash).toBe(b.hash);
  });

  it('changes the hash when any content changes', () => {
    const a = buildContextManifest({ s: 'hello world' });
    const b = buildContextManifest({ s: 'hello worle' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('is order-stable: section ordering does not change the top-level hash', () => {
    const a = buildContextManifest({ x: 'one', y: 'two' });
    const b = buildContextManifest({ y: 'two', x: 'one' });
    expect(a.hash).toBe(b.hash);
  });

  it('handles an empty manifest without throwing', () => {
    const m = buildContextManifest({});
    expect(m.totalChars).toBe(0);
    expect(m.sections).toEqual([]);
    expect(typeof m.hash).toBe('string');
  });

  it('never throws on junk input', () => {
    const m = buildContextManifest(undefined as unknown as never);
    expect(m.totalChars).toBe(0);
    expect(m.sections).toEqual([]);
  });
});
