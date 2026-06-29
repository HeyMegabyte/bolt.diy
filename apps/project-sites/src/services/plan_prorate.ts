/**
 * @module services/plan_prorate
 * @description Pure proration math for plan billing — mid-cycle upgrades,
 * downgrades, cancellations, and add-ons. Every function is a deterministic
 * function of its numeric inputs: same cents + days → same cents out.
 *
 * All amounts are in **cents** (integer, never fractional dollars).
 * All day values are **integer days** (floor of any fractional day).
 *
 * ## Convention
 *
 * | Function | Semantics | Use case |
 * |---|---|---|
 * | `prorateAmount(cents, daysUsed, daysInPeriod)` | Charge for the used portion | New plan charge on upgrade |
 * | `prorateRefund(cents, daysRemaining, daysInPeriod)` | Refund for the unused portion | Old plan refund on upgrade |
 *
 * `DAYS_IN_MONTH` (30) is the canonical period for monthly billing.
 * Callers provide `daysInPeriod` explicitly — the constant is a
 * convenience default, not a global override.
 */

/** Default billing period length in days (30-day month convention). */
export const DAYS_IN_MONTH = 30 as const;

/**
 * Compute the prorated amount (in cents) for the portion of a billing
 * period already used.
 *
 * Returns `Math.round(cents * daysUsed / daysInPeriod)`, clamped to
 * `[0, cents]`. When `daysInPeriod ≤ 0` or `daysUsed ≤ 0` the result
 * is `0`.
 *
 * @param cents - Total period amount in cents (must be ≥ 0).
 * @param daysUsed - Number of days already consumed in the period.
 * @param daysInPeriod - Total days in the billing period.
 * @returns Prorated charge in cents (integer).
 *
 * @example
 * prorateAmount(3000, 10, 30); // 3000 * 10/30 = 1000
 * // => 1000
 *
 * @example
 * prorateAmount(3000, 0, 30);  // no days used → 0
 * // => 0
 *
 * @example
 * prorateAmount(3000, 30, 30); // full period → 3000
 * // => 3000
 */
export function prorateAmount(cents: number, daysUsed: number, daysInPeriod: number): number {
  if (cents <= 0 || daysInPeriod <= 0 || daysUsed <= 0) return 0;
  if (daysUsed >= daysInPeriod) return cents;
  return Math.round((cents * daysUsed) / daysInPeriod);
}

/**
 * Compute the prorated refund (in cents) for the unused portion of a
 * billing period.
 *
 * Returns `Math.round(cents * daysRemaining / daysInPeriod)`, clamped to
 * `[0, cents]`. When `daysInPeriod ≤ 0` or `daysRemaining ≤ 0` the result
 * is `0`.
 *
 * @param cents - Total period amount in cents (must be ≥ 0).
 * @param daysRemaining - Number of days remaining (unused) in the period.
 * @param daysInPeriod - Total days in the billing period.
 * @returns Prorated refund in cents (integer).
 *
 * @example
 * prorateRefund(3000, 20, 30); // 3000 * 20/30 = 2000
 * // => 2000
 *
 * @example
 * prorateRefund(3000, 0, 30);  // no days remaining → 0
 * // => 0
 *
 * @example
 * prorateRefund(3000, 30, 30); // full period unused → 3000
 * // => 3000
 */
export function prorateRefund(cents: number, daysRemaining: number, daysInPeriod: number): number {
  if (cents <= 0 || daysInPeriod <= 0 || daysRemaining <= 0) return 0;
  if (daysRemaining >= daysInPeriod) return cents;
  return Math.round((cents * daysRemaining) / daysInPeriod);
}
