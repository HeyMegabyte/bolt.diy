/**
 * Loyalty pricing — backlog item #24.
 *
 * Counts completed bookings between a (customer, crew) pair. Every 5th
 * completion gets the application_fee_amount reduced by 5% (i.e., booking
 * #5, #10, #15…). Returns a multiplier between 0 and 1 that callers
 * multiply against the base application fee.
 *
 * @example
 * ```ts
 * const factor = await loyaltyApplicationFeeFactor(env, { tenantId, customerId, crewId });
 * const applicationFeeCents = Math.round(baseFeeCents * factor);
 * ```
 */

import type { Env } from '../env.js';
import { dbQueryOne } from './db.js';

export const LOYALTY_DISCOUNT_PCT = 5;
export const LOYALTY_INTERVAL = 5;

export interface LoyaltyContext {
  tenantId: string;
  customerId: string;
  crewId: string;
}

export interface LoyaltyDecision {
  /** Multiplier to apply to base application fee (1.0 = no discount, 0.95 = 5% off). */
  readonly applicationFeeFactor: number;
  readonly completedCount: number;
  readonly nextBookingNumber: number;
  readonly discountApplied: boolean;
}

/**
 * Compute the loyalty application-fee factor for the next booking between
 * `customer` and `crew`. The "next booking" is the one currently being priced
 * — so we return 0.95 when the upcoming booking is the 5th, 10th, 15th, etc.
 */
export async function evaluateLoyalty(
  env: Env,
  ctx: LoyaltyContext,
): Promise<LoyaltyDecision> {
  const row = await dbQueryOne<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM loyalty_completions
      WHERE tenant_id = ?1 AND customer_id = ?2 AND crew_id = ?3`,
    [ctx.tenantId, ctx.customerId, ctx.crewId],
  );
  const completed = row?.n ?? 0;
  const next = completed + 1;
  const discountApplied = next % LOYALTY_INTERVAL === 0;
  const factor = discountApplied ? (100 - LOYALTY_DISCOUNT_PCT) / 100 : 1;
  return {
    applicationFeeFactor: factor,
    completedCount: completed,
    nextBookingNumber: next,
    discountApplied,
  };
}

/** Record a completed booking pair. Called when a job transitions to `completed`. */
export async function recordLoyaltyCompletion(
  env: Env,
  args: LoyaltyContext & { bookingId: string; discountApplied: boolean },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO loyalty_completions
       (id, tenant_id, customer_id, crew_id, booking_id, completed_at, discount_applied)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      crypto.randomUUID(),
      args.tenantId,
      args.customerId,
      args.crewId,
      args.bookingId,
      new Date().toISOString(),
      args.discountApplied ? 1 : 0,
    )
    .run();
}

// ── #32 Multi-stop bundle discount ──────────────────────────────────────────

/** Bundle-discount thresholds — externalised so tests + finance can tune. */
export const BUNDLE_DISCOUNT_PCT = 12;
export const BUNDLE_MIN_BOOKINGS = 2;

/** Minimal booking shape consumed by {@link evaluateBundle}. */
export interface BundleBooking {
  readonly id: string;
  readonly customer_id: string;
  readonly crew_id: string | null;
  /** ISO datetime; only the calendar-day portion matters. */
  readonly scheduled_for: string | null;
}

export interface BundleDecision {
  readonly bundleApplies: boolean;
  readonly discountPct: number;
  /** Multiplier to apply to base application fee (1.0 = no discount, 0.88 = 12% off). */
  readonly applicationFeeFactor: number;
  readonly bundleDate: string | null;
  readonly bookingIds: readonly string[];
  readonly reason: 'too-few' | 'mixed-customer' | 'mixed-crew' | 'mixed-day' | 'applied';
}

/** Calendar-day key (YYYY-MM-DD) extracted from an ISO timestamp. */
function dayKey(iso: string | null): string | null {
  if (!iso) return null;
  const idx = iso.indexOf('T');
  return idx > 0 ? iso.slice(0, idx) : iso.slice(0, 10);
}

/**
 * Backlog item #32 — when ≥2 bookings share the same customer, the same crew,
 * and the same calendar day, apply a 12% bundle discount on the marketplace
 * application fee. Pure function — caller persists the decision via
 * {@link recordBundleDiscount}.
 *
 * @example
 * ```ts
 * const decision = evaluateBundle(bookings);
 * if (decision.bundleApplies) {
 *   appFee = Math.round(appFee * decision.applicationFeeFactor);
 * }
 * ```
 */
export function evaluateBundle(bookings: readonly BundleBooking[]): BundleDecision {
  if (bookings.length < BUNDLE_MIN_BOOKINGS) {
    return {
      bundleApplies: false,
      discountPct: 0,
      applicationFeeFactor: 1,
      bundleDate: null,
      bookingIds: bookings.map((b) => b.id),
      reason: 'too-few',
    };
  }
  const first = bookings[0]!;
  const customerId = first.customer_id;
  const crewId = first.crew_id;
  const day = dayKey(first.scheduled_for);

  for (const b of bookings) {
    if (b.customer_id !== customerId) {
      return mismatch(bookings, 'mixed-customer');
    }
    if ((b.crew_id ?? '') !== (crewId ?? '')) {
      return mismatch(bookings, 'mixed-crew');
    }
    if (dayKey(b.scheduled_for) !== day) {
      return mismatch(bookings, 'mixed-day');
    }
  }
  return {
    bundleApplies: true,
    discountPct: BUNDLE_DISCOUNT_PCT,
    applicationFeeFactor: (100 - BUNDLE_DISCOUNT_PCT) / 100,
    bundleDate: day,
    bookingIds: bookings.map((b) => b.id),
    reason: 'applied',
  };
}

function mismatch(
  bookings: readonly BundleBooking[],
  reason: BundleDecision['reason'],
): BundleDecision {
  return {
    bundleApplies: false,
    discountPct: 0,
    applicationFeeFactor: 1,
    bundleDate: null,
    bookingIds: bookings.map((b) => b.id),
    reason,
  };
}

/** Persist the bundle decision for audit. Idempotent on (tenant, customer, bundle_date). */
export async function recordBundleDiscount(
  env: Env,
  args: {
    tenantId: string;
    customerId: string;
    crewId: string | null;
    decision: BundleDecision;
    baseApplicationFeeCents: number;
  },
): Promise<void> {
  if (!args.decision.bundleApplies || !args.decision.bundleDate) return;
  const discounted = Math.round(
    args.baseApplicationFeeCents * args.decision.applicationFeeFactor,
  );
  await env.DB.prepare(
    `INSERT INTO bundle_discounts
       (id, tenant_id, customer_id, crew_id, bundle_date, booking_ids, booking_count,
        discount_pct, base_application_fee_cents, discounted_application_fee_cents)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      crypto.randomUUID(),
      args.tenantId,
      args.customerId,
      args.crewId,
      args.decision.bundleDate,
      JSON.stringify(args.decision.bookingIds),
      args.decision.bookingIds.length,
      args.decision.discountPct,
      args.baseApplicationFeeCents,
      discounted,
    )
    .run();
}
