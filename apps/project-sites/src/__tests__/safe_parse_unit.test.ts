import { safeParseJSON, safeParseJSONOrNull } from '../utils/safe-parse.js';

describe('safeParseJSON', () => {
  it('parses valid JSON into the expected shape', () => {
    expect(safeParseJSON<{ count: number }>('{"count":3}', { count: 0 })).toEqual({ count: 3 });
  });
  it('returns the fallback on invalid JSON', () => {
    expect(safeParseJSON<{ count: number }>('not json', { count: 0 })).toEqual({ count: 0 });
  });
  it('returns the fallback on null / undefined / empty string', () => {
    expect(safeParseJSON(null, 'fb')).toBe('fb');
    expect(safeParseJSON(undefined, 'fb')).toBe('fb');
    expect(safeParseJSON('', 'fb')).toBe('fb');
  });
  it('parses JSON primitives + arrays', () => {
    expect(safeParseJSON<number>('42', 0)).toBe(42);
    expect(safeParseJSON<number[]>('[1,2,3]', [])).toEqual([1, 2, 3]);
    expect(safeParseJSON<boolean>('false', true)).toBe(false);
  });
});

describe('safeParseJSONOrNull', () => {
  it('parses valid JSON', () => {
    expect(safeParseJSONOrNull<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
  });
  it('returns null on invalid JSON / null / undefined / empty', () => {
    expect(safeParseJSONOrNull('broken')).toBeNull();
    expect(safeParseJSONOrNull(null)).toBeNull();
    expect(safeParseJSONOrNull(undefined)).toBeNull();
    expect(safeParseJSONOrNull('')).toBeNull();
  });
});
