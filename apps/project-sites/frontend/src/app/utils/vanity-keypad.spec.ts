import { vanityToDigits, hasVanityLetters } from './vanity-keypad';

/**
 * §17 Find-a-Number: the live keypad preview must render EXACTLY the digits the
 * worker's `contains=` search resolves to (E.161 map, non-letters preserved).
 * These lock the mapping the help text + preview chip advertise.
 */
describe('vanityToDigits (E.161 keypad mapping)', () => {
  it('maps MOVE → 6683', () => {
    expect(vanityToDigits('MOVE')).toBe('6683');
  });

  it('maps LABOR → 52267 (5 letters → 5 digits — not the old "5227" typo)', () => {
    expect(vanityToDigits('LABOR')).toBe('52267');
  });

  it('maps BRICK → 27425', () => {
    expect(vanityToDigits('BRICK')).toBe('27425');
  });

  it('is case-insensitive', () => {
    expect(vanityToDigits('move')).toBe('6683');
    expect(vanityToDigits('MoVe')).toBe('6683');
  });

  it('passes digits through untouched (mixed word + digits)', () => {
    expect(vanityToDigits('82LABOR')).toBe('8252267');
  });

  it('preserves non-letter punctuation + Twilio wildcard like the worker', () => {
    expect(vanityToDigits('1-800-FLOWERS')).toBe('1-800-3569377');
    expect(vanityToDigits('82*ABOR')).toBe('82*2267');
  });

  it('covers the full A-Z keypad', () => {
    expect(vanityToDigits('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('22233344455566677778889999');
  });

  it('returns empty for empty input', () => {
    expect(vanityToDigits('')).toBe('');
  });
});

describe('hasVanityLetters', () => {
  it('is true when a letter is present', () => {
    expect(hasVanityLetters('MOVE')).toBeTrue();
    expect(hasVanityLetters('82LABOR')).toBeTrue();
  });

  it('is false for digits-only or empty (no preview needed)', () => {
    expect(hasVanityLetters('8553334444')).toBeFalse();
    expect(hasVanityLetters('')).toBeFalse();
    expect(hasVanityLetters('1-800')).toBeFalse();
  });
});
