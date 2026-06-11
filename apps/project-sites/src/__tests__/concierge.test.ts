import { formatSources } from '../routes/concierge';

describe('concierge formatSources', () => {
  it('prefers metadata title, then url, then sourceId, then kind', () => {
    const r = formatSources([
      { kind: 'page', score: 0.9, metadata: { title: 'Hours' } },
      { kind: 'page', score: 0.8, metadata: { url: 'https://x/pricing' } },
      { kind: 'faq', score: 0.7, sourceId: 'faq-7' },
      { kind: 'service', score: 0.6 },
    ]);
    expect(r.map((s) => s.title)).toEqual(['Hours', 'https://x/pricing', 'faq-7', 'service']);
  });

  it('dedupes by title and rounds score to 2dp', () => {
    const r = formatSources([
      { kind: 'page', score: 0.918, metadata: { title: 'Hours' } },
      { kind: 'page', score: 0.4, metadata: { title: 'Hours' } },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(0.92);
  });

  it('caps at 5 sources', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      kind: 'p',
      score: 0.5,
      sourceId: `s${i}`,
    }));
    expect(formatSources(many)).toHaveLength(5);
  });

  it('is safe on empty / missing input', () => {
    expect(formatSources([])).toEqual([]);
    expect(formatSources(undefined as never)).toEqual([]);
  });
});
