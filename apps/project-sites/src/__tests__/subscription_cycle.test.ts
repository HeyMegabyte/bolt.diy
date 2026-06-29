/**
 * Unit tests for the subscription cycle module.
 *
 * Covers computeCycleEvent and prorateAmount with all plan-change types
 * and edge cases.
 */
import {
  PLAN_PRICES,
  computeCycleEvent,
  prorateAmount,
} from '../services/subscription_cycle.js';
import type { PlanChange, BillingCycle } from '../services/subscription_cycle.js';

// ─── PLAN_PRICES ──────────────────────────────────────────────────

describe('PLAN_PRICES', () => {
  it('defines three plans with correct monthly prices', () => {
    expect(PLAN_PRICES.free.monthly).toBe(0);
    expect(PLAN_PRICES.starter.monthly).toBe(15);
    expect(PLAN_PRICES.pro.monthly).toBe(50);
  });

  it('defines three plans with correct annual prices', () => {
    expect(PLAN_PRICES.free.annual).toBe(0);
    expect(PLAN_PRICES.starter.annual).toBe(150);
    expect(PLAN_PRICES.pro.annual).toBe(500);
  });

  it('annual prices are exactly 10× monthly for starter and pro', () => {
    expect(PLAN_PRICES.starter.annual).toBe(PLAN_PRICES.starter.monthly * 10);
    expect(PLAN_PRICES.pro.annual).toBe(PLAN_PRICES.pro.monthly * 10);
  });
});

// ─── computeCycleEvent ────────────────────────────────────────────

describe('computeCycleEvent', () => {
  const NOW = 1_750_000_000_000; // Fixed timestamp for determinism.

  // ── upgrade ─────────────────────────────────────────────────────

  it('upgrade from free to starter sets effectiveAt = now and prorates the difference', () => {
    const event = computeCycleEvent('free', 'starter', 'upgrade', NOW);

    expect(event.plan).toBe('starter');
    expect(event.change).toBe('upgrade');
    expect(event.effectiveAt).toBe(NOW);
    expect(event.proration).toBe(15);
    expect(event.credits).toBe(0);
  });

  it('upgrade from starter to pro prorates $35', () => {
    const event = computeCycleEvent('starter', 'pro', 'upgrade', NOW);

    expect(event.proration).toBe(35);
    expect(event.plan).toBe('pro');
  });

  it('upgrade from free to pro prorates $50', () => {
    const event = computeCycleEvent('free', 'pro', 'upgrade', NOW);

    expect(event.proration).toBe(50);
  });

  it('upgrade from pro to free (same price) prorates 0', () => {
    const event = computeCycleEvent('pro', 'free', 'upgrade', NOW);

    expect(event.proration).toBe(0);
    expect(event.plan).toBe('free');
  });

  it('upgrade from unknown plan defaults to 0 price', () => {
    const event = computeCycleEvent('unknown_enterprise', 'starter', 'upgrade', NOW);

    expect(event.proration).toBe(15); // 15 - 0
    expect(event.plan).toBe('starter');
  });

  // ── downgrade ───────────────────────────────────────────────────

  it('downgrade takes effect at end of 30-day period with no proration', () => {
    const event = computeCycleEvent('pro', 'starter', 'downgrade', NOW);

    expect(event.plan).toBe('starter');
    expect(event.change).toBe('downgrade');
    expect(event.effectiveAt).toBe(NOW + 30 * 24 * 60 * 60 * 1000);
    expect(event.proration).toBe(0);
    expect(event.credits).toBe(0);
  });

  it('downgrade from starter to free', () => {
    const event = computeCycleEvent('starter', 'free', 'downgrade', NOW);

    expect(event.plan).toBe('free');
    expect(event.proration).toBe(0);
  });

  // ── cancel ──────────────────────────────────────────────────────

  it('cancel keeps the current plan and takes effect at end of period', () => {
    const event = computeCycleEvent('pro', 'pro', 'cancel', NOW);

    expect(event.plan).toBe('pro');
    expect(event.change).toBe('cancel');
    expect(event.effectiveAt).toBe(NOW + 30 * 24 * 60 * 60 * 1000);
    expect(event.proration).toBe(0);
    expect(event.credits).toBe(0);
  });

  it('cancel from starter keeps the plan name in the event', () => {
    const event = computeCycleEvent('starter', 'starter', 'cancel', NOW);

    expect(event.plan).toBe('starter');
  });

  // ── reactivate ──────────────────────────────────────────────────

  it('reactivate takes effect immediately and charges the new plan price', () => {
    const event = computeCycleEvent('free', 'starter', 'reactivate', NOW);

    expect(event.plan).toBe('starter');
    expect(event.change).toBe('reactivate');
    expect(event.effectiveAt).toBe(NOW);
    expect(event.proration).toBe(15);
    expect(event.credits).toBe(0);
  });

  it('reactivate to free charges 0', () => {
    const event = computeCycleEvent('free', 'free', 'reactivate', NOW);

    expect(event.proration).toBe(0);
  });

  it('reactivate to pro charges $50', () => {
    const event = computeCycleEvent('free', 'pro', 'reactivate', NOW);

    expect(event.proration).toBe(50);
  });

  // ── defaults ────────────────────────────────────────────────────

  it('uses Date.now() when nowMs is omitted', () => {
    const before = Date.now();
    const event = computeCycleEvent('free', 'starter', 'upgrade');
    const after = Date.now();

    expect(event.effectiveAt).toBeGreaterThanOrEqual(before);
    expect(event.effectiveAt).toBeLessThanOrEqual(after);
  });
});

// ─── prorateAmount ────────────────────────────────────────────────

describe('prorateAmount', () => {
  const PERIOD_START = 1_000_000_000_000;

  // ── monthly ─────────────────────────────────────────────────────

  it('returns half price when change is at midpoint of a monthly period', () => {
    const midPeriod = PERIOD_START + 15 * 24 * 60 * 60 * 1000;

    const result = prorateAmount(15, 'monthly', midPeriod, PERIOD_START);

    // 15 days remaining out of 30 → 50% of $15 = $7.5
    expect(result).toBe(7.5);
  });

  it('returns full price when change is at the start of the period', () => {
    const result = prorateAmount(15, 'monthly', PERIOD_START, PERIOD_START);

    expect(result).toBe(15);
  });

  it('returns 0 when change is at the end of the period', () => {
    const periodEnd = PERIOD_START + 30 * 24 * 60 * 60 * 1000;

    const result = prorateAmount(15, 'monthly', periodEnd, PERIOD_START);

    expect(result).toBe(0);
  });

  it('returns 0 when change is past the end of the period', () => {
    const pastEnd = PERIOD_START + 45 * 24 * 60 * 60 * 1000;

    const result = prorateAmount(15, 'monthly', pastEnd, PERIOD_START);

    expect(result).toBe(0);
  });

  it('returns 0 for zero price', () => {
    const result = prorateAmount(0, 'monthly', PERIOD_START + 5_000_000, PERIOD_START);

    expect(result).toBe(0);
  });

  it('rounds to two decimal places', () => {
    // 1 day remaining out of 30 → 1/30 of $10 = $0.333...
    const dayBeforeEnd = PERIOD_START + 29 * 24 * 60 * 60 * 1000;

    const result = prorateAmount(10, 'monthly', dayBeforeEnd, PERIOD_START);

    expect(result).toBe(0.33);
  });

  // ── annual ──────────────────────────────────────────────────────

  it('returns half price when change is at midpoint of an annual period', () => {
    const midPeriod = PERIOD_START + 183 * 24 * 60 * 60 * 1000;

    const result = prorateAmount(150, 'annual', midPeriod, PERIOD_START);

    // ~50% of $150 = ~$75
    expect(result).toBeGreaterThan(74);
    expect(result).toBeLessThan(76);
  });

  it('returns full annual price at start of period', () => {
    const result = prorateAmount(150, 'annual', PERIOD_START, PERIOD_START);

    expect(result).toBe(150);
  });

  it('returns 0 at end of annual period', () => {
    const periodEnd = PERIOD_START + 365 * 24 * 60 * 60 * 1000;

    const result = prorateAmount(150, 'annual', periodEnd, PERIOD_START);

    expect(result).toBe(0);
  });
});
