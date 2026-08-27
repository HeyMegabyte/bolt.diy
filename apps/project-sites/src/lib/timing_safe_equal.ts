/**
 * @module lib/timing_safe_equal
 *
 * @description
 * Canonical constant-time string comparison — the SINGLE owner of the
 * timing-safe-equal primitive used across every HMAC/token verification path
 * (webhook signatures, magic-link tokens, capability-manifest signatures,
 * team-invite tokens, share tokens). Consolidated from 5 divergent in-file copies
 * so there is ONE audited, constant-time implementation; the 3 that used an early
 * `if (a.length !== b.length) return false` (a length-leaking non-const-time
 * short-circuit) are upgraded by adopting this version.
 *
 * @packageDocumentation
 */

/**
 * Constant-time string equality — prevents timing side-channels on secret/HMAC
 * comparison. Folds the length difference into the accumulator and always loops
 * the longer input, so neither the result nor the loop count leaks via an early
 * return. Intended for ASCII / hex / base64 signature strings.
 *
 * @param a - First string (e.g. the presented signature).
 * @param b - Second string (e.g. the expected signature).
 * @returns `true` iff both strings are character-for-character equal.
 *
 * @example
 * timingSafeEqual('abc', 'abc');  // → true
 * timingSafeEqual('abc', 'xyz');  // → false
 * timingSafeEqual('abc', 'abcd'); // → false
 */
export function timingSafeEqual(a: string, b: string): boolean {
  let result = a.length ^ b.length;
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    result |= (a.charCodeAt(i) ?? 0) ^ (b.charCodeAt(i) ?? 0);
  }
  return result === 0;
}
