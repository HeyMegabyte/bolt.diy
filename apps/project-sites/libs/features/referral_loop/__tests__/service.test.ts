/**
 * Unit tests for the referral_loop service.
 *
 * Stubbed D1 — these tests prove the pure logic without hitting Wrangler.
 */

import { mintReferralCode } from '../service.js';
import { REFERRAL_CODE_LENGTH } from '../schemas.js';

describe('referral_loop/service', () => {
  describe('mintReferralCode', () => {
    test('returns a code of the configured length', () => {
      const code = mintReferralCode();
      expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    });

    test('uses only uppercase alphanumerics from the read-safe alphabet', () => {
      // 100 codes is plenty to flush out any bad alphabet entries.
      for (let i = 0; i < 100; i++) {
        const code = mintReferralCode();
        expect(code).toMatch(/^[A-HK-NP-Z2-9]+$/);
      }
    });

    test('produces different codes on successive calls', () => {
      const codes = new Set<string>();
      for (let i = 0; i < 50; i++) codes.add(mintReferralCode());
      // Practically zero chance of a collision in 50 ten-char codes
      // drawn from a 31-letter alphabet (31^10 ≈ 8.2e14 space).
      expect(codes.size).toBe(50);
    });

    test('honours an explicit length argument', () => {
      expect(mintReferralCode(6)).toHaveLength(6);
      expect(mintReferralCode(16)).toHaveLength(16);
    });
  });
});
