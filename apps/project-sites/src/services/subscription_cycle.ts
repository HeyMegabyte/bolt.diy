/**
 * Subscription cycle — pure zero-I/O service module.
 *
 * Models plan-change semantics: compute cycle events (upgrade/downgrade/
 * cancel/reactivate timing + proration) and prorate amounts across billing
 * periods. No imports from services/db/worker. All functions are pure.
 */

// ─── Duration constants ───────────────────────────────────────────

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────

export type BillingCycle = 'monthly' | 'annual';

export type PlanChange = 'upgrade' | 'downgrade' | 'cancel' | 'reactivate';

export interface CycleEvent {
  readonly plan: string;
  readonly change: PlanChange;
  readonly effectiveAt: number;
  readonly proration: number;
  readonly credits: number;
}

// ─── Pricing ──────────────────────────────────────────────────────

/** Canonical plan prices in dollars (monthly / annual). */
export const PLAN_PRICES: Record<string, { monthly: number; annual: number }> = {
  free: { monthly: 0, annual: 0 },
  starter: { monthly: 15, annual: 150 },
  pro: { monthly: 50, annual: 500 },
};

// ─── Public API ───────────────────────────────────────────────────

/**
 * Compute a cycle event for a plan change.
 *
 * Upgrades and reactivations take effect immediately; downgrades and
 * cancellations take effect at the end of the current 30-day billing
 * period. Proration represents the immediate financial delta (positive =
 * charge to the customer). Credits represent any credit balance applied.
 *
 * @param currentPlan - Name of the current plan (key in PLAN_PRICES).
 * @param newPlan - Name of the target plan (key in PLAN_PRICES).
 * @param change - Type of plan change.
 * @param nowMs - Optionally override the current timestamp. Defaults to
 *                `Date.now()`.
 * @returns A cycle event describing the timing, proration, and credits.
 *
 * @example
 * const event = computeCycleEvent('free', 'starter', 'upgrade');
 * // { plan: 'starter', change: 'upgrade', effectiveAt: 1_750_000_000_000,
 * //   proration: 15, credits: 0 }
 *
 * @example
 * const event = computeCycleEvent('pro', 'starter', 'downgrade');
 * // { plan: 'starter', change: 'downgrade',
 * //   effectiveAt: now + 30 * 24 * 60 * 60 * 1000,
 * //   proration: 0, credits: 0 }
 *
 * @example
 * const event = computeCycleEvent('starter', 'starter', 'cancel');
 * // { plan: 'starter', change: 'cancel',
 * //   effectiveAt: now + 30 * 24 * 60 * 60 * 1000,
 * //   proration: 0, credits: 0 }
 *
 * @example
 * const event = computeCycleEvent('free', 'pro', 'reactivate', 1_000_000);
 * // { plan: 'pro', change: 'reactivate', effectiveAt: 1_000_000,
 * //   proration: 50, credits: 0 }
 */
export function computeCycleEvent(
  currentPlan: string,
  newPlan: string,
  change: PlanChange,
  nowMs: number = Date.now(),
): CycleEvent {
  const currentPrice = PLAN_PRICES[currentPlan]?.monthly ?? 0;
  const newPrice = PLAN_PRICES[newPlan]?.monthly ?? 0;

  switch (change) {
    case 'upgrade':
      return {
        plan: newPlan,
        change,
        effectiveAt: nowMs,
        proration: Math.max(0, newPrice - currentPrice),
        credits: 0,
      };
    case 'downgrade':
      return {
        plan: newPlan,
        change,
        effectiveAt: nowMs + MS_PER_MONTH,
        proration: 0,
        credits: 0,
      };
    case 'cancel':
      return {
        plan: currentPlan,
        change,
        effectiveAt: nowMs + MS_PER_MONTH,
        proration: 0,
        credits: 0,
      };
    case 'reactivate':
      return {
        plan: newPlan,
        change,
        effectiveAt: nowMs,
        proration: newPrice,
        credits: 0,
      };
  }
}

/**
 * Prorate a plan price based on the remaining time in a billing period.
 *
 * Given the full-period price and the current position within the period,
 * computes the proportional amount for the remaining duration. Rounds
 * to two decimal places.
 *
 * When `changeDate` is at or past `periodEnd`, returns 0.
 *
 * @param planPrice - Full-period price in dollars (e.g. 15 for $15/mo).
 * @param cycle - Monthly (30 days) or annual (365 days).
 * @param changeDate - Timestamp (ms) when the change occurs.
 * @param periodStart - Timestamp (ms) when the current billing period
 *                      began.
 * @returns The prorated amount in dollars, rounded to 2 decimal places.
 *
 * @example
 * // $15/mo plan, changed 15 days into a 30-day period
 * prorateAmount(15, 'monthly', periodStart + 15 * 86400000, periodStart)
 * // => 7.5 (7.5 remaining days)
 *
 * @example
 * prorateAmount(0, 'monthly', 1_000_000, 500_000)
 * // => 0
 */
export function prorateAmount(
  planPrice: number,
  cycle: BillingCycle,
  changeDate: number,
  periodStart: number,
): number {
  if (planPrice <= 0) return 0;

  const periodMs = cycle === 'monthly' ? MS_PER_MONTH : 365 * 24 * 60 * 60 * 1000;
  const periodEnd = periodStart + periodMs;
  const remainingMs = Math.max(0, periodEnd - changeDate);
  const fraction = remainingMs / periodMs;

  return +(planPrice * fraction).toFixed(2);
}
