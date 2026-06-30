import { diffText, diffStats, applyDiff, type ContentDiff } from '../services/content_diff.js';

describe('diffText (word-level content diff)', () => {
  it('detects added words', () => {
    const d = diffText('hello world', 'hello beautiful world');
    expect(d.added).toEqual(['beautiful']);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toEqual(['hello', 'world']);
  });

  it('detects removed words', () => {
    const d = diffText('a b c', 'b c');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual(['a']);
    expect(d.unchanged).toEqual(['b', 'c']);
  });

  it('detects simultaneous adds and removes', () => {
    const d = diffText('hello world cup', 'hello there world');
    expect(d.added).toEqual(['there']);
    expect(d.removed).toEqual(['cup']);
    expect(d.unchanged).toEqual(['hello', 'world']);
  });

  it('handles repeated words with different counts', () => {
    const d = diffText('a b c c', 'b c d');
    // unchanged: min(1,1)=1 'b', min(2,1)=1 'c' (old-text order: b, c)
    // removed: 'a' (1-0), 'c' (2-1)
    expect(d.added).toEqual(['d']);
    expect(d.removed).toEqual(['a', 'c']);
    expect(d.unchanged).toEqual(['b', 'c']);
  });

  it('preserves repeated words across both texts', () => {
    const d = diffText('la la la', 'la la');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual(['la']);
    expect(d.unchanged).toEqual(['la', 'la']); // min(3,2) = 2 copies
  });

  it('handles identical texts', () => {
    const d = diffText('hello world', 'hello world');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toEqual(['hello', 'world']);
  });

  it('handles completely different texts', () => {
    const d = diffText('alpha beta', 'gamma delta');
    expect(d.added).toEqual(['gamma', 'delta']);
    expect(d.removed).toEqual(['alpha', 'beta']);
    expect(d.unchanged).toEqual([]);
  });

  it('handles empty old text', () => {
    const d = diffText('', 'hello world');
    expect(d.added).toEqual(['hello', 'world']);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toEqual([]);
  });

  it('handles empty new text', () => {
    const d = diffText('hello world', '');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual(['hello', 'world']);
    expect(d.unchanged).toEqual([]);
  });

  it('handles null and undefined inputs', () => {
    const d1 = diffText(null, 'hello');
    expect(d1.added).toEqual(['hello']);
    expect(d1.removed).toEqual([]);

    const d2 = diffText('hello', undefined);
    expect(d2.added).toEqual([]);
    expect(d2.removed).toEqual(['hello']);

    const d3 = diffText(null, undefined);
    expect(d3.added).toEqual([]);
    expect(d3.removed).toEqual([]);
    expect(d3.unchanged).toEqual([]);
  });

  it('treats extra whitespace as empty words (ignored)', () => {
    const d = diffText('  hello   world  ', 'hello world');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toEqual(['hello', 'world']);
  });

  it('is case-sensitive', () => {
    const d = diffText('Hello World', 'hello world');
    expect(d.removed).toEqual(['Hello', 'World']);
    expect(d.added).toEqual(['hello', 'world']);
    expect(d.unchanged).toEqual([]);
  });
});

describe('diffStats', () => {
  it('counts additions, deletions, and unchanged', () => {
    const d: ContentDiff = { added: ['x'], removed: ['y'], unchanged: ['a', 'b'] };
    const s = diffStats(d);
    expect(s.additions).toBe(1);
    expect(s.deletions).toBe(1);
    expect(s.unchanged).toBe(2);
  });

  it('computes changeRate from a mixed diff', () => {
    const d = diffText('hello world cup', 'hello there world');
    const s = diffStats(d);
    expect(s.additions).toBe(1); // 'there'
    expect(s.deletions).toBe(1); // 'cup'
    expect(s.unchanged).toBe(2); // 'hello', 'world'
    expect(s.changeRate).toBeCloseTo(0.5); // 2 / 4
  });

  it('returns 0 changeRate for an empty diff', () => {
    const s = diffStats({ added: [], removed: [], unchanged: [] });
    expect(s.changeRate).toBe(0);
  });

  it('returns 1 changeRate when everything changed', () => {
    const d = diffText('alpha', 'beta');
    const s = diffStats(d);
    expect(s.changeRate).toBe(1);
  });

  it('returns 0 changeRate for identical texts', () => {
    const d = diffText('same same', 'same same');
    const s = diffStats(d);
    expect(s.changeRate).toBe(0);
  });
});

describe('applyDiff (approximate reconstruction)', () => {
  it('reconstructs new text from old text', () => {
    const d = diffText('hello world cup', 'hello there world');
    const result = applyDiff('hello world cup', d);
    // Removed 'cup', added 'there' at end
    expect(result.split(/\s+/).sort()).toEqual(['hello', 'there', 'world'].sort());
  });

  it('removes words and appends added words', () => {
    const d = diffText('a b c', 'd e');
    const result = applyDiff('a b c', d);
    expect(result.split(/\s+/).sort()).toEqual(['d', 'e'].sort());
  });

  it('is idempotent-ish: applying the diff preserves same word bag', () => {
    const oldT = 'alpha beta gamma';
    const newT = 'alpha delta epsilon';
    const d = diffText(oldT, newT);
    const reconstructed = applyDiff(oldT, d);
    // Word multiset matches (order may differ due to bag-of-words limitation)
    const reconstructedSorted = reconstructed.split(/\s+/).sort();
    const newTSorted = newT.split(/\s+/).sort();
    expect(reconstructedSorted).toEqual(newTSorted);
  });

  it('handles a no-change diff', () => {
    const d = diffText('stay', 'stay');
    const result = applyDiff('stay', d);
    expect(result).toBe('stay');
  });

  it('handles diff from empty to something', () => {
    const d = diffText('', 'new stuff');
    const result = applyDiff('', d);
    expect(result).toBe('new stuff');
  });

  it('handles diff from something to empty', () => {
    const d = diffText('some text', '');
    const result = applyDiff('some text', d);
    expect(result).toBe('');
  });

  it('applies the diff in a way that produces the same word multiset', () => {
    const oldT = 'the quick brown fox jumps over the lazy dog';
    const newT = 'a quick brown cat jumps under the lazy rat';
    const d = diffText(oldT, newT);
    const result = applyDiff(oldT, d);
    const resultWords = result.split(/\s+/).sort();
    const newWords = newT.split(/\s+/).sort();
    expect(resultWords).toEqual(newWords);
  });
});
