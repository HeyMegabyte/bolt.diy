/**
 * @module __tests__/plan_migration
 * @description Unit tests for plan migration calculator (computeMigration, isUpgrade, PLAN_TIER).
 */

import { computeMigration, isUpgrade, PLAN_TIER } from '../services/plan_migration.js';

// 30-day billing cycle: June 2025 (month indexes are 0-based in Date.UTC)
const CYCLE_START = Date.UTC(2025, 5, 1); // 2025-06-01 00:00 UTC
const CYCLE_END = Date.UTC(2025, 6, 1); // 2025-07-01 00:00 UTC

const MID_CYCLE = Date.UTC(2025, 5, 16); // 2025-06-16 00:00 UTC → 15 days remaining
const DAY1_7AM = Date.UTC(2025, 5, 1, 7); // 2025-06-01 07:00 UTC → 29 remaining (floor)
const CYCLE_LAST = Date.UTC(2025, 5, 30); // 2025-06-30 00:00 UTC → 1 day remaining
const PAST_END = Date.UTC(2025, 6, 1, 19); // 2025-07-01 19:00 UTC → past end → 0 remaining
const DAY_20 = CYCLE_START + 20 * 86_400_000; // 20 days elapsed → 10 days remaining

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

  it('treats unknown plan as below-free tier; moving to free is an upgrade', () => {
    // Unknown → -1, free → 0.  0 > -1 → true.
    expect(isUpgrade('enterprise', 'free')).toBe(true);
    expect(isUpgrade('bogus', 'pro')).toBe(true);
    expect(isUpgrade('bogus', 'bogus')).toBe(false);
  });
});

describe('computeMigration', () => {
  it('refunds unused portion, charges remaining portion mid-cycle (15 of 30 days)', () => {
    const r = computeMigration('starter', 'pro', 1500, 2900, CYCLE_START, CYCLE_END, MID_CYCLE);
    expect(r.fromPlan).toBe('starter');
    expect(r.toPlan).toBe('pro');
    expect(r.daysRemaining).toBe(15);
    expect(r.proratedRefund).toBe(750); // 1500 * 15/30
    expect(r.newCharge).toBe(1450); // 2900 * 15/30
    expect(r.effectiveDate).toBe(MID_CYCLE);
  });

  it('returns correct proration on day 1 with 29 days remaining (floor)', () => {
    const r = computeMigration('starter', 'pro', 1500, 2900, CYCLE_START, CYCLE_END, DAY1_7AM);
    expect(r.daysRemaining).toBe(29);
    expect(r.proratedRefund).toBe(1450); // 1500 * 29/30 = 1450 (exact)
    expect(r.newCharge).toBe(2803); // 2900 * 29/30 ≈ 2803.33 → 2803
  });

  it('returns 0 refund/charge when now is at cycle end (0 days remaining)', () => {
    const r = computeMigration('pro', 'free', 2900, 0, CYCLE_START, CYCLE_END, CYCLE_LAST);
    expect(r.daysRemaining).toBe(1); // last day still counts
    expect(r.proratedRefund).toBe(97); // 2900 * 1/30 ≈ 96.67 → 97
    expect(r.newCharge).toBe(0);
  });

  it('returns 0 remaining when now is past the cycle end', () => {
    const r = computeMigration('pro', 'starter', 2900, 1500, CYCLE_START, CYCLE_END, PAST_END);
    expect(r.daysRemaining).toBe(0);
    expect(r.proratedRefund).toBe(0);
    expect(r.newCharge).toBe(0);
    expect(r.effectiveDate).toBe(CYCLE_END);
  });

  it('handles free tier (zero price) correctly', () => {
    const r = computeMigration('free', 'starter', 0, 1500, CYCLE_START, CYCLE_END, MID_CYCLE);
    expect(r.proratedRefund).toBe(0);
    expect(r.newCharge).toBe(750); // 1500 * 15/30 = 750
    expect(r.daysRemaining).toBe(15);
  });

  it('rounds prorated amounts to nearest integer', () => {
    // 10 days remaining = 20 days elapsed
    const r = computeMigration('starter', 'pro', 1499, 2999, CYCLE_START, CYCLE_END, DAY_20);
    // 1499 * 10/30 ≈ 499.67 → 500
    expect(r.proratedRefund).toBe(500);
    // 2999 * 10/30 ≈ 999.67 → 1000
    expect(r.newCharge).toBe(1000);
    expect(r.daysRemaining).toBe(10);
  });

  it('never throws on zero-length or inverted cycle', () => {
    const r = computeMigration('pro', 'free', 2900, 0, CYCLE_END, CYCLE_START, MID_CYCLE);
    expect(r.proratedRefund).toBe(0);
    expect(r.newCharge).toBe(0);
    expect(r.daysRemaining).toBe(0);
  });

  it('never throws on zero prices', () => {
    const r = computeMigration('free', 'free', 0, 0, CYCLE_START, CYCLE_END, MID_CYCLE);
    expect(r.proratedRefund).toBe(0);
    expect(r.newCharge).toBe(0);
    expect(r.daysRemaining).toBe(15);
  });
});
