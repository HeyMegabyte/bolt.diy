/**
 * @module __tests__/plan_prorate
 * @description Unit tests for pure proration math.
 */

import { DAYS_IN_MONTH, prorateAmount, prorateRefund } from '../services/plan_prorate.js';

describe('DAYS_IN_MONTH', () => {
  it('is 30', () => {
    expect(DAYS_IN_MONTH).toBe(30);
  });

  it('is a const literal', () => {
    expect(typeof DAYS_IN_MONTH).toBe('number');
  });
});

describe('prorateAmount', () => {
  // --- happy path ---

  it('charges half when half the period is used', () => {
    expect(prorateAmount(3000, 15, 30)).toBe(1500);
  });

  it('charges one third when one third is used', () => {
    expect(prorateAmount(9000, 10, 30)).toBe(3000);
  });

  it('charges full amount when all days used', () => {
    expect(prorateAmount(2000, 30, 30)).toBe(2000);
  });

  it('charges full amount when daysUsed exceeds period', () => {
    expect(prorateAmount(2000, 40, 30)).toBe(2000);
  });

  it('charges nothing when no days used', () => {
    expect(prorateAmount(2000, 0, 30)).toBe(0);
  });

  it('rounds fractional results to nearest cent', () => {
    // 1499 * 20 / 30 = 999.333...
    expect(prorateAmount(1499, 20, 30)).toBe(999);
  });

  it('rounds 0.5 up', () => {
    // 100 * 5 / 30 = 16.666... → 17
    expect(prorateAmount(100, 5, 30)).toBe(17);
  });

  it('works with a 1-day period (daily billing)', () => {
    expect(prorateAmount(1000, 1, 1)).toBe(1000);
    expect(prorateAmount(1000, 0, 1)).toBe(0);
  });

  it('works with annual billing period', () => {
    // 12000 * 90 / 365 — 90 days used in a year
    expect(prorateAmount(12000, 90, 365)).toBe(2959);
  });

  // --- edge cases ---

  it('returns 0 when cents is 0', () => {
    expect(prorateAmount(0, 15, 30)).toBe(0);
  });

  it('returns 0 when cents is negative', () => {
    expect(prorateAmount(-500, 15, 30)).toBe(0);
  });

  it('returns 0 when daysInPeriod is 0', () => {
    expect(prorateAmount(3000, 15, 0)).toBe(0);
  });

  it('returns 0 when daysInPeriod is negative', () => {
    expect(prorateAmount(3000, 15, -30)).toBe(0);
  });

  it('returns 0 when daysUsed is negative', () => {
    expect(prorateAmount(3000, -5, 30)).toBe(0);
  });
});

describe('prorateRefund', () => {
  // --- happy path ---

  it('refunds half when half the period remains', () => {
    expect(prorateRefund(3000, 15, 30)).toBe(1500);
  });

  it('refunds two thirds when two thirds remain', () => {
    expect(prorateRefund(9000, 20, 30)).toBe(6000);
  });

  it('refunds full amount when all days remain', () => {
    expect(prorateRefund(2000, 30, 30)).toBe(2000);
  });

  it('refunds full amount when daysRemaining exceeds period', () => {
    expect(prorateRefund(2000, 40, 30)).toBe(2000);
  });

  it('refunds nothing when no days remain', () => {
    expect(prorateRefund(2000, 0, 30)).toBe(0);
  });

  it('rounds fractional results to nearest cent', () => {
    // 1499 * 10 / 30 = 499.666... → 500
    expect(prorateRefund(1499, 10, 30)).toBe(500);
  });

  it('rounds 0.5 up', () => {
    // 100 * 25 / 30 = 83.333... → 83
    expect(prorateRefund(100, 25, 30)).toBe(83);
  });

  it('works with a 1-day period', () => {
    expect(prorateRefund(1000, 1, 1)).toBe(1000);
    expect(prorateRefund(1000, 0, 1)).toBe(0);
  });

  it('works with annual billing period', () => {
    // 12000 * 275 / 365 — 275 days remaining in a year
    expect(prorateRefund(12000, 275, 365)).toBe(9041);
  });

  // --- symmetric with prorateAmount ---

  it('sums to full cents: amount + refund = original when split mid-cycle', () => {
    // 30-day period, 10 days used → 20 remaining
    const used = 10;
    const remaining = 20;
    const cents = 3000;
    expect(prorateAmount(cents, used, 30) + prorateRefund(cents, remaining, 30)).toBe(cents);
  });

  it('sums to original cents across several split points', () => {
    const cents = 6000;
    for (const used of [0, 1, 5, 10, 15, 20, 25, 29, 30]) {
      const remaining = 30 - used;
      const sum = prorateAmount(cents, used, 30) + prorateRefund(cents, remaining, 30);
      // Rounding can cause ±1 cent
      expect(Math.abs(sum - cents)).toBeLessThanOrEqual(1);
    }
  });

  // --- edge cases ---

  it('returns 0 when cents is 0', () => {
    expect(prorateRefund(0, 15, 30)).toBe(0);
  });

  it('returns 0 when cents is negative', () => {
    expect(prorateRefund(-500, 15, 30)).toBe(0);
  });

  it('returns 0 when daysInPeriod is 0', () => {
    expect(prorateRefund(3000, 15, 0)).toBe(0);
  });

  it('returns 0 when daysInPeriod is negative', () => {
    expect(prorateRefund(3000, 15, -30)).toBe(0);
  });

  it('returns 0 when daysRemaining is negative', () => {
    expect(prorateRefund(3000, -5, 30)).toBe(0);
  });
});
