/**
 * Email validator — Jasmine/Karma unit tests.
 *
 * @remarks
 * The frontend uses Karma + Jasmine (no Vitest configured — `ng test` runs the
 * Angular test runner). These specs cover the syntactic contract that mirrors
 * the backend `emailSchema` from `@project-sites/shared/schemas/base`.
 *
 * Coverage targets: empty input, whitespace, RFC-style happy path, plus-tag
 * addresses, the 254-char cap from RFC 5321, and the lowercasing rule baked
 * into the backend schema.
 */
import { emailError, isValidEmail, normalizeEmail } from './email';

describe('isValidEmail', () => {
  it('rejects null / undefined / empty string', () => {
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('rejects strings that are only whitespace', () => {
    expect(isValidEmail('   ')).toBe(false);
    expect(isValidEmail('\t\n')).toBe(false);
  });

  it('rejects values without an @ or TLD', () => {
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a@b.')).toBe(false);
    expect(isValidEmail('@b.co')).toBe(false);
  });

  it('accepts standard RFC-style addresses', () => {
    expect(isValidEmail('hey@megabyte.space')).toBe(true);
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
  });

  it('accepts plus-tag and dotted local parts', () => {
    expect(isValidEmail('user+tag@example.com')).toBe(true);
    expect(isValidEmail('first.last@example.com')).toBe(true);
  });

  it('rejects values that exceed the 254-char RFC 5321 cap', () => {
    const longLocal = 'a'.repeat(250);
    expect(isValidEmail(`${longLocal}@b.co`)).toBe(false);
  });

  it('trims surrounding whitespace before validating', () => {
    expect(isValidEmail('  hey@megabyte.space  ')).toBe(true);
  });
});

describe('emailError', () => {
  it('asks for an email when blank', () => {
    expect(emailError('')).toBe('Add your email so we can reach you.');
    expect(emailError('   ')).toBe('Add your email so we can reach you.');
    expect(emailError(null)).toBe('Add your email so we can reach you.');
  });

  it('flags too-long inputs with their own message', () => {
    const longLocal = 'a'.repeat(250);
    expect(emailError(`${longLocal}@b.co`)).toBe(
      'That email is too long. Double-check it and try again.',
    );
  });

  it('returns the generic "looks off" message for malformed addresses', () => {
    expect(emailError('not-an-email')).toBe(
      'Email looks off — try again (you@example.com).',
    );
  });

  it('returns null for valid input', () => {
    expect(emailError('hey@megabyte.space')).toBeNull();
    expect(emailError('  hey@megabyte.space  ')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Hey@MegaByte.Space  ')).toBe('hey@megabyte.space');
  });

  it('leaves already-normalized input untouched', () => {
    expect(normalizeEmail('hey@megabyte.space')).toBe('hey@megabyte.space');
  });
});
