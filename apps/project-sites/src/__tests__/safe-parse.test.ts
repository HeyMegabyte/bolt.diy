/**
 * Unit tests for src/utils/safe-parse.ts.
 *
 * Covers empty / null / undefined / invalid JSON / valid JSON / unicode /
 * deeply nested input and confirms that the helpers never throw.
 */
import { safeParseJSON, safeParseJSONOrNull } from '../utils/safe-parse';

describe('safeParseJSON', () => {
  it('returns fallback for null', () => {
    expect(safeParseJSON<{ a: number }>(null, { a: 7 })).toEqual({ a: 7 });
  });

  it('returns fallback for undefined', () => {
    expect(safeParseJSON<number[]>(undefined, [])).toEqual([]);
  });

  it('returns fallback for empty string', () => {
    expect(safeParseJSON<string>('', 'default')).toBe('default');
  });

  it('returns fallback for malformed JSON', () => {
    expect(safeParseJSON<{ ok: boolean }>('{not json', { ok: false })).toEqual({ ok: false });
  });

  it('returns fallback for half-quoted JSON', () => {
    expect(safeParseJSON<unknown>('"abc', null)).toBeNull();
  });

  it('returns parsed value for valid JSON object', () => {
    expect(safeParseJSON<{ count: number }>('{"count":3}', { count: 0 })).toEqual({ count: 3 });
  });

  it('returns parsed value for valid JSON array', () => {
    expect(safeParseJSON<number[]>('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

  it('returns parsed value for valid JSON primitive', () => {
    expect(safeParseJSON<boolean>('true', false)).toBe(true);
    expect(safeParseJSON<number>('42', 0)).toBe(42);
    expect(safeParseJSON<string>('"hi"', '')).toBe('hi');
  });

  it('parses nested objects', () => {
    const raw = '{"a":{"b":{"c":[1,2,{"d":true}]}}}';
    expect(safeParseJSON<{ a: { b: { c: unknown[] } } }>(raw, { a: { b: { c: [] } } }))
      .toEqual({ a: { b: { c: [1, 2, { d: true }] } } });
  });

  it('parses unicode strings', () => {
    expect(safeParseJSON<{ name: string }>('{"name":"Doña Élise"}', { name: '' }))
      .toEqual({ name: 'Doña Élise' });
  });

  it('never throws on bizarre input', () => {
    expect(() => safeParseJSON<unknown>('{', null)).not.toThrow();
    expect(() => safeParseJSON<unknown>('[', null)).not.toThrow();
    expect(() => safeParseJSON<unknown>('NaN', null)).not.toThrow();
  });
});

describe('safeParseJSONOrNull', () => {
  it('returns null for null', () => {
    expect(safeParseJSONOrNull<{ a: number }>(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(safeParseJSONOrNull<{ a: number }>(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(safeParseJSONOrNull<{ a: number }>('')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(safeParseJSONOrNull<{ a: number }>('{bad')).toBeNull();
  });

  it('returns parsed value for valid JSON', () => {
    expect(safeParseJSONOrNull<{ ok: boolean }>('{"ok":true}')).toEqual({ ok: true });
  });

  it('returns parsed primitive false correctly (not coerced to null)', () => {
    expect(safeParseJSONOrNull<boolean>('false')).toBe(false);
  });

  it('returns parsed 0 correctly (not coerced to null)', () => {
    expect(safeParseJSONOrNull<number>('0')).toBe(0);
  });
});
