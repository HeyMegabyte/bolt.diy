import { sanitizeLikeTerm } from '../services/like_pattern.js';

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
