import { timingSafeEqual } from '../lib/timing_safe_equal.js';

describe('timingSafeEqual (canonical constant-time compare)', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
    const hex = 'deadbeef'.repeat(8); // 64-char hex, HMAC-SHA256 shape
    expect(timingSafeEqual(hex, hex)).toBe(true);
  });

  it('returns false for equal-length differing content', () => {
    expect(timingSafeEqual('abc', 'xyz')).toBe(false);
    expect(timingSafeEqual('deadbeef', 'deadbee0')).toBe(false); // differs in last nibble
  });

  it('returns false for differing lengths (either direction)', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
    expect(timingSafeEqual('a', '')).toBe(false);
  });
});
