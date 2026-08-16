import { sanitizeLikeTerm, boundLikePattern } from '../services/like_pattern.js';

describe('sanitizeLikeTerm', () => {
  it('strips %, _ and \\ so the wrapped pattern has only the intended outer wildcards', () => {
    expect(sanitizeLikeTerm('a%b_c')).toBe('abc');
    expect(sanitizeLikeTerm('50% off')).toBe('50 off');
    expect(sanitizeLikeTerm('a\\b')).toBe('ab');
  });

  it('leaves ordinary text untouched (no wildcards → unchanged)', () => {
    expect(sanitizeLikeTerm("Vito's Salon")).toBe("Vito's Salon");
    expect(sanitizeLikeTerm('')).toBe('');
  });

  it('neutralizes a pathological wildcard-heavy term (the pattern-too-complex trigger)', () => {
    // `%_`×30 is what tripped SQLite's "LIKE pattern too complex" in prod — even WITH
    // an ESCAPE clause. Stripping leaves ZERO wildcards, so `%${result}%` is trivial.
    const evil = '%_'.repeat(30);
    expect(sanitizeLikeTerm(evil)).toBe('');
    expect(/[%_]/.test(sanitizeLikeTerm(evil))).toBe(false);
  });
});

// boundLikePattern is the OTHER half of the LIKE-safety story: for callers that
// legitimately WANT wildcards (an LLM-built admin filter, a glob→LIKE route
// filter), stripping is wrong — but an unbounded wildcard count still trips D1's
// "pattern too complex" → swallowed → lying-empty. This preserves intent while
// capping complexity. See [[d1-like-wildcard-strip-not-escape]].
describe('boundLikePattern', () => {
  const wildcards = (s: string) => (s.match(/[%_]/g) ?? []).length;

  it('preserves an ordinary single-wildcard pattern (intentional wildcard survives)', () => {
    expect(boundLikePattern('site.%')).toBe('site.%');
    expect(boundLikePattern('%@gmail.com')).toBe('%@gmail.com');
    expect(boundLikePattern('/api/sites/%')).toBe('/api/sites/%');
  });

  it('collapses a run of % to a single wildcard (the classic too-complex trigger)', () => {
    expect(boundLikePattern('%'.repeat(60))).toBe('%');
  });

  it('caps total wildcard count so D1 never raises "pattern too complex"', () => {
    const evil = '%_'.repeat(30); // 60 wildcards — tripped SQLite in prod
    expect(wildcards(boundLikePattern(evil))).toBeLessThanOrEqual(12);
  });

  it('length-bounds the pattern (defuses megabyte inputs)', () => {
    expect(boundLikePattern('a'.repeat(500)).length).toBeLessThanOrEqual(128);
  });
});
