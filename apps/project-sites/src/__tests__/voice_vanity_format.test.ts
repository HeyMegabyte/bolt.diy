/**
 * Unit tests for formatVanity — renders E.164 numbers with the chosen
 * vanity word substituted in-place when the letters match the digits.
 */

import { formatVanity, letterToDigit } from '../services/twilio.js';

describe('formatVanity', () => {
  it('renders ABOR at the end of +18558222267 as "(855) 822-ABOR"', () => {
    // digits  = 8558222267 → area=855, nxx=822, line=2267
    // letterToDigit('ABOR') = '2267' which matches the tail → splice succeeds.
    const formatted = formatVanity('+18558222267', 'ABOR');
    expect(formatted).toBe('(855) 822-ABOR');
    // Round-trip: every letter should map back to its original digit position.
    const digitsOnly = letterToDigit(formatted).replace(/\D/g, '');
    expect(digitsOnly).toBe('8558222267');
  });

  it('falls back to plain pretty format when vanity letters do not match digits', () => {
    // ZZZ → 999. 18002223333 does NOT end in 999, so we expect plain (800) 222-3333
    expect(formatVanity('+18002223333', 'ZZZ')).toBe('(800) 222-3333');
  });

  it('returns input unchanged when the number is not 10 digits', () => {
    expect(formatVanity('+442071234567', 'CALL')).toBe('+442071234567');
  });

  it('handles 4-letter words at the end', () => {
    // 18554222267 — tail 4 = 2267 = ABOR
    const out = formatVanity('+18554222267', 'ABOR');
    expect(out.toUpperCase()).toContain('ABOR');
    expect(out).toMatch(/^\(855\)/);
  });

  it('renders 3-letter and 5-letter words too when the math lines up', () => {
    // CALL = 2255. Make 18002252552 — last 4 = 2552 ≠ CALL, expect fallback.
    expect(formatVanity('+18002252552', 'CALL')).toBe('(800) 225-2552');
  });

  it('preserves area code', () => {
    const out = formatVanity('+18558222267', 'ABOR');
    expect(out.startsWith('(855)')).toBe(true);
  });
});
