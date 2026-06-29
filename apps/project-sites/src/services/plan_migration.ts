/**
 * @module services/plan_migration
 * @description Plan migration calculator: when a user switches plans, compute
 * pro-ration, credits, and effective date. Pure functions with no I/O.
 */

// ── Constants ───────────────────────────────────────────────

/**
 * Numeric plan tiers for ordering. Higher = more capability.
 * Used by {@link isUpgrade} to determine whether a migration
 * from one plan to another constitutes an upgrade.
 *
 * Add new plans here; the order must match the plan hierarchy.
 */
export const PLAN_TIER: Record<string, number> = {
  free: 0,
  pro: 2,
  starter: 1,
} as const;

// ── Types ───────────────────────────────────────────────────

export interface MigrationResult {
  /** Name of the plan the user is leaving. */
  readonly fromPlan: string;
  /** Name of the plan the user is switching to. */
  readonly toPlan: string;
  /** Prorated refund for the unused portion of the current cycle, in same unit as price inputs. */
  readonly proratedRefund: number;
  /** Prorated charge for the remaining portion of the cycle at the new plan price. */
  readonly newCharge: number;
  /** Unix ms timestamp when the migration takes effect. */
  readonly effectiveDate: number;
  /** Full days remaining in the current billing cycle (floor). */
  readonly daysRemaining: number;
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * @param nowMs - Current wall clock in Unix ms. Defaults to `Date.now()`.
 * @param cycleStart - Billing cycle start in Unix ms.
 * @param cycleEnd - Billing cycle end in Unix ms.
 * @returns Full days remaining in the current cycle (floor at 0).
 */
function calculateDaysRemaining(nowMs: number, cycleStart: number, cycleEnd: number): number {
  // Clamp to cycle boundaries so a value past the end yields 0, not negative.
  const clamped = Math.max(cycleStart, Math.min(nowMs, cycleEnd));
  const total = cycleEnd - cycleStart;
  if (total <= 0) return 0;
  const elapsed = clamped - cycleStart;
  const remaining = total - elapsed;
  return Math.max(0, Math.floor(remaining / 86_400_000));
}

/**
 * Linear proration: fraction of a monthly price for the remaining portion of the cycle.
 *
 * @param price - Full monthly price in cents (or any unit).
 * @param daysRemaining - Whole days left in the billing cycle.
 * @param cycleStart - Billing cycle start in Unix ms.
 * @param cycleEnd - Billing cycle end in Unix ms.
 * @returns Prorated amount, rounded to the nearest integer.
 */
function prorate(
  price: number,
  daysRemaining: number,
  cycleStart: number,
  cycleEnd: number,
): number {
  const totalDays = (cycleEnd - cycleStart) / 86_400_000;
  if (totalDays <= 0 || daysRemaining <= 0) return 0;
  const fraction = daysRemaining / totalDays;
  return Math.round(price * fraction);
}

// ── Public API ──────────────────────────────────────────────

/**
 * Compute the financial result of switching from one plan to another mid-cycle.
 *
 * Produces a {@link MigrationResult} with a prorated refund for the current plan
 * and a prorated charge for the new plan, both covering only the remaining days
 * in the billing cycle. The effective date is set to the moment of migration.
 *
 * @param fromPlan - Name of the current plan (used for reference only).
 * @param toPlan - Name of the target plan (used for reference only).
 * @param fromPrice - Monthly price of the current plan in cents (or any unit).
 * @param toPrice - Monthly price of the target plan in cents.
 * @param cycleStart - Unix ms timestamp when the current billing cycle started.
 * @param cycleEnd - Unix ms timestamp when the current billing cycle ends.
 * @param nowMs - Optional override for "now". Defaults to `Date.now()`.
 * @returns A {@link MigrationResult} with prorated refund, charge, and days remaining.
 *
 * @example
 * // 15 days left in a 30-day cycle, switching Starter ($1500/mo) → Pro ($2900/mo)
 * const cycleStart = 1748736000000; // 2025-06-01
 * const cycleEnd   = 1751328000000; // 2025-07-01
 * const nowMs      = 1749859200000; // 2025-06-15
 * const r = computeMigration('starter', 'pro', 1500, 2900, cycleStart, cycleEnd, nowMs);
 * // → { fromPlan:'starter', toPlan:'pro', proratedRefund:750, newCharge:1450, daysRemaining:15, … }
 *
 * @example
 * // Downgrade with zero days remaining → no refund, no charge
 * const r2 = computeMigration('pro', 'free', 2900, 0, cycleStart, cycleEnd, cycleEnd);
 * // → { proratedRefund:0, newCharge:0, daysRemaining:0 }
 */
export function computeMigration(
  fromPlan: string,
  toPlan: string,
  fromPrice: number,
  toPrice: number,
  cycleStart: number,
  cycleEnd: number,
  nowMs: number = Date.now(),
): MigrationResult {
  const effectiveDate = nowMs < cycleStart ? cycleStart : nowMs > cycleEnd ? cycleEnd : nowMs;
  const daysRemaining = calculateDaysRemaining(effectiveDate, cycleStart, cycleEnd);
  const proratedRefund = prorate(fromPrice, daysRemaining, cycleStart, cycleEnd);
  const newCharge = prorate(toPrice, daysRemaining, cycleStart, cycleEnd);

  return {
    daysRemaining,
    effectiveDate,
    fromPlan,
    newCharge,
    proratedRefund,
    toPlan,
  };
}

/**
 * Determine whether switching from `fromPlan` to `toPlan` is an upgrade
 * (higher tier), downgrade (lower tier), or lateral move (same tier).
 *
 * Uses {@link PLAN_TIER} to resolve numeric tiers. Returns `true` when
 * the target plan's tier exceeds the source plan's tier.
 *
 * @param fromPlan - Current plan name. Must be a key of {@link PLAN_TIER}.
 * @param toPlan - Target plan name. Must be a key of {@link PLAN_TIER}.
 * @returns `true` when toPlan is a higher tier than fromPlan.
 *
 * @example
 * isUpgrade('free', 'pro')     // → true
 * isUpgrade('pro', 'free')     // → false
 * isUpgrade('starter', 'pro')  // → true
 * isUpgrade('pro', 'pro')      // → false (same tier)
 */
export function isUpgrade(fromPlan: string, toPlan: string): boolean {
  const from = PLAN_TIER[fromPlan] ?? -1;
  const to = PLAN_TIER[toPlan] ?? -1;
  return to > from;
}
