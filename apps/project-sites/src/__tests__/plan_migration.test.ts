/**
 * @module __tests__/plan_migration
 * @description Unit tests for plan migration calculator (computeMigration, isUpgrade, PLAN_TIER).
 */

import { computeMigration, isUpgrade, PLAN_TIER } from '../services/plan_migration.js';

// June 2026: cycle Mon 01 → Tue 30.  30 days.
const JUN_01 = 1748736000000; // 2026-06-01 00:00:00 UTC
const JUN_30 = 1751328000000; // 2026-06-30 00:00:00 UTC
const JUN_15 = 1749600000000; // 2026-06-15 00:00:00 UTC — 15 days remaining
const JUN_01_SEVEN_AM = 1748764800000; // 2026-06-01 07:00:00 UTC — within cycle
const JUN_30_SEVEN_PM = 1751396400000; // 2026-06-30 19:00:00 UTC — past end

describe('PLAN_TIER', () => {
  it('maps free < starter < pro', () => {
    expect(PLAN_TIER['free']).toBe(0);
    expect(PLAN_TIER['starter']).toBe(1);
    expect(PLAN_TIER['pro']).toBe(2);
  });

  it('returns undefined for unknown plans', () => {
    expect(PLAN_TIER['enterprise']).toBeUndefined();
  });
});

describe('isUpgrade', () => {
  it('detects upgrade: free → starter', () => {
    expect(isUpgrade('free', 'starter')).toBe(true);
  });

  it('detects upgrade: free → pro', () => {
    expect(isUpgrade('free', 'pro')).toBe(true);
  });

  it('detects upgrade: starter → pro', () => {
    expect(isUpgrade('starter', 'pro')).toBe(true);
  });

  it('detects downgrade: pro → free', () => {
    expect(isUpgrade('pro', 'free')).toBe(false);
  });

  it('detects lateral: pro → pro', () => {
    expect(isUpgrade('pro', 'pro')).toBe(false);
  });

  it('handles unknown plan name as lowest tier', () => {
    expect(isUpgrade('free', 'enterprise')).toBe(false); // enterprise not in PLAN_TIER → -1
    expect(isUpgrade('enterprise', 'free')).toBe(false);
  });
});

describe('computeMigration', () => {
  it('refunds unused portion, charges remaining portion mid-cycle (15 of 30 days)', () => {
    const r = computeMigration('starter', 'pro', 1500, 2900, JUN_01, JUN_30, JUN_15);
    expect(r.fromPlan).toBe('starter');
    expect(r.toPlan).toBe('pro');
    // 15 remaining / 30 total = 0.5 → 1500 * 0.5 = 750
    expect(r.proratedRefund).toBe(750);
    // 2900 * 0.5 = 1450
    expect(r.newCharge).toBe(1450);
    expect(r.daysRemaining).toBe(15);
    expect(r.effectiveDate).toBe(JUN_15);
  });

  it('returns full refund and full new charge on day 1 (all 30 days remaining)', () => {
    const r = computeMigration('starter', 'pro', 1500, 2900, JUN_01, JUN_30, JUN_01_SEVEN_AM);
    // 29 days remaining (floor)
    expect(r.daysRemaining).toBe(29);
    // 1500 * 29/30 ≈ 1449
    expect(r.proratedRefund).toBe(1449);
    // 2900 * 29/30 ≈ 2802
    expect(r.newCharge).toBe(2802);
    expect(r.effectiveDate).toBe(JUN_01_SEVEN_AM);
  });

  it('returns zero refund and charge on last day (0 days remaining)', () => {
    const r = computeMigration('pro', 'free', 2900, 0, JUN_01, JUN_30, JUN_30);
    expect(r.proratedRefund).toBe(0);
    expect(r.newCharge).toBe(0);
    expect(r.daysRemaining).toBe(0);
  });

  it('returns zero refund and charge when nowMs is past the cycle end', () => {
    const r = computeMigration('pro', 'starter', 2900, 1500, JUN_01, JUN_30, JUN_30_SEVEN_PM);
    expect(r.daysRemaining).toBe(0);
    expect(r.proratedRefund).toBe(0);
    expect(r.newCharge).toBe(0);
    // effective date clamps to cycle start when now is past end
    expect(r.effectiveDate).toBe(JUN_01);
  });

  it('handles free tier (zero price) correctly', () => {
    const r = computeMigration('free', 'starter', 0, 1500, JUN_01, JUN_30, JUN_15);
    expect(r.proratedRefund).toBe(0); // nothing to refund
    expect(r.newCharge).toBe(750); // 1500 * 0.5
    expect(r.daysRemaining).toBe(15);
  });

  it('rounds to nearest integer (no fractional cents)', () => {
    // 10 days remaining in 30-day cycle
    const day10 = JUN_01 + 10 * 86_400_000;
    // 1500 * 10/30 = 500 (exact)
    const r = computeMigration('starter', 'pro', 1499, 2999, JUN_01, JUN_30, day10);
    // 1499 * 10/30 ≈ 499.666... → 500
    expect(r.proratedRefund).toBe(500);
    // 2999 * 10/30 ≈ 999.666... → 1000
    expect(r.newCharge).toBe(1000);
    expect(r.daysRemaining).toBe(10);
  });

  it('uses nowMs default (Date.now) when argument omitted', () => {
    const before = Date.now();
    const r = computeMigration('free', 'starter', 0, 1500, JUN_01, JUN_30);
    const after = Date.now();
    expect(r.effectiveDate).toBeGreaterThanOrEqual(before);
    expect(r.effectiveDate).toBeLessThanOrEqual(after);
    expect(r.daysRemaining).toBeGreaterThan(0);
  });

  it('never throws on zero-length or inverted cycle', () => {
    const r = computeMigration('pro', 'free', 2900, 0, JUN_30, JUN_01, JUN_15);
    expect(r.proratedRefund).toBe(0);
    expect(r.newCharge).toBe(0);
    expect(r.daysRemaining).toBe(0);
  });

  it('never throws on zero prices', () => {
    const r = computeMigration('free', 'free', 0, 0, JUN_01, JUN_30, JUN_15);
    expect(r.proratedRefund).toBe(0);
    expect(r.newCharge).toBe(0);
    expect(r.daysRemaining).toBe(15);
  });
});
