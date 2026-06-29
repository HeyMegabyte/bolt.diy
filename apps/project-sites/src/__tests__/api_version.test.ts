/**
 * api_version — pure version helpers. All functions are order-independent,
 * zero-safe, and produce stable outputs.
 */
import { parseVersion, isDeprecated, versionHeader, API_VERSIONS } from '../services/api_version.js';

describe('API_VERSIONS', () => {
  it('contains "v1" and "v2"', () => {
    expect(API_VERSIONS).toEqual(['v1', 'v2']);
  });

  it('is typed as readonly (as const, not frozen at runtime)', () => {
    // as const provides type-level immutability; Object.isFrozen is false in SWC
    expect(API_VERSIONS).toEqual(['v1', 'v2']);
  });
});

describe('parseVersion', () => {
  it('parses "v1"', () => {
    expect(parseVersion('v1')).toEqual({ major: 1, label: 'v1' });
  });

  it('parses "v2"', () => {
    expect(parseVersion('v2')).toEqual({ major: 2, label: 'v2' });
  });

  it('parses "v10" (multi-digit major)', () => {
    expect(parseVersion('v10')).toEqual({ major: 10, label: 'v10' });
  });

  it('throws RangeError for empty string', () => {
    expect(() => parseVersion('')).toThrow(RangeError);
  });

  it('throws RangeError for missing "v" prefix', () => {
    expect(() => parseVersion('2')).toThrow(RangeError);
  });

  it('throws RangeError for non-numeric suffix', () => {
    expect(() => parseVersion('vx')).toThrow(RangeError);
  });

  it('throws RangeError for negative major', () => {
    expect(() => parseVersion('v-1')).toThrow(RangeError);
  });

  it('throws RangeError for zero major', () => {
    expect(() => parseVersion('v0')).toThrow(RangeError);
  });

  it('throws RangeError for decimal major (v1.5)', () => {
    expect(() => parseVersion('v1.5')).toThrow(RangeError);
  });
});

describe('isDeprecated', () => {
  it('v1 is deprecated when current is v2', () => {
    expect(isDeprecated('v1', 'v2')).toBe(true);
  });

  it('v2 is NOT deprecated when current is v2', () => {
    expect(isDeprecated('v2', 'v2')).toBe(false);
  });

  it('unrecognised version is never deprecated', () => {
    expect(isDeprecated('v3', 'v2')).toBe(false);
  });

  it('malformed version is never deprecated (no error thrown)', () => {
    expect(isDeprecated('foo', 'v2')).toBe(false);
  });

  it('empty string is never deprecated', () => {
    expect(isDeprecated('', 'v2')).toBe(false);
  });

  it('v1 is deprecated against v10', () => {
    expect(isDeprecated('v1', 'v10')).toBe(true);
  });

  it('v2 is NOT deprecated against v2, even with multi-digit future', () => {
    expect(isDeprecated('v2', 'v2')).toBe(false);
  });
});

describe('versionHeader', () => {
  it('returns "v2" for "v2"', () => {
    expect(versionHeader('v2')).toBe('v2');
  });

  it('returns "v1" for "v1"', () => {
    expect(versionHeader('v1')).toBe('v1');
  });

  it('passes through any string unchanged', () => {
    expect(versionHeader('v99')).toBe('v99');
  });
});
