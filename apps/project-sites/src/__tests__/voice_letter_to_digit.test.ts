/**
 * Unit tests for letter→digit conversion (E.161 keypad mapping).
 */

import { letterToDigit } from '../services/twilio.js';

describe('letterToDigit', () => {
  it('maps A-Z to E.161 keypad digits (uppercase)', () => {
    expect(letterToDigit('ABC')).toBe('222');
    expect(letterToDigit('DEF')).toBe('333');
    expect(letterToDigit('GHI')).toBe('444');
    expect(letterToDigit('JKL')).toBe('555');
    expect(letterToDigit('MNO')).toBe('666');
    expect(letterToDigit('PQRS')).toBe('7777');
    expect(letterToDigit('TUV')).toBe('888');
    expect(letterToDigit('WXYZ')).toBe('9999');
  });

  it('is case-insensitive', () => {
    expect(letterToDigit('abor')).toBe('2267');
    expect(letterToDigit('ABOR')).toBe('2267');
    expect(letterToDigit('AbOr')).toBe('2267');
  });

  it('passes non-letter characters through unchanged', () => {
    expect(letterToDigit('1-800-FLOWERS')).toBe('1-800-3569377');
    expect(letterToDigit('82*ABOR')).toBe('82*2267');
    expect(letterToDigit('+1-800-CALLNOW')).toBe('+1-800-2255669');
  });

  it('handles empty string', () => {
    expect(letterToDigit('')).toBe('');
  });

  it('handles the reference example ABOR → 2267', () => {
    expect(letterToDigit('ABOR')).toBe('2267');
  });

  it('handles a 7-letter word', () => {
    expect(letterToDigit('LAWYERS')).toBe('5299377');
  });
});
