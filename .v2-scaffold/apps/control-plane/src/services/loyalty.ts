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
