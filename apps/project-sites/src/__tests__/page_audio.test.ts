import { chunkForTts } from '../routes/page_audio';

describe('chunkForTts', () => {
  it('returns [] for blank text', () => {
    expect(chunkForTts('   ')).toEqual([]);
  });

  it('returns a single chunk when under the limit', () => {
    expect(chunkForTts('Hello there. Welcome.')).toEqual(['Hello there. Welcome.']);
  });

  it('splits on sentence boundaries, each chunk under max', () => {
    const sentence = 'a'.repeat(30) + '. ';
    const text = sentence.repeat(10); // ~320 chars
    const chunks = chunkForTts(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    // round-trips the content (ignoring whitespace)
    expect(chunks.join(' ').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
  });

  it('hard-splits a single oversized sentence', () => {
    const huge = 'x'.repeat(250); // no sentence punctuation
    const chunks = chunkForTts(huge, 100);
    expect(chunks).toEqual(['x'.repeat(100), 'x'.repeat(100), 'x'.repeat(50)]);
  });

  it('collapses whitespace', () => {
    expect(chunkForTts('one\n\n  two\t three')).toEqual(['one two three']);
  });
});
