/**
 * @module services/org_seats
 *
 * @description
 * Seat-enforcement logic for org membership (#25). PURE decision functions — given
 * the current member count, outstanding (pending) invitations, and the plan's seat
 * limit, decide whether another member may be invited. Pending invitations RESERVE
 * a seat (the common correctness bug: counting only accepted members lets an org
 * over-invite past its limit, then over-fill when invites are accepted).
 *
 * The plan→seat mapping is injected by the caller (from billing entitlements) so
 * this stays decoupled + unit-testable; `SEAT_LIMITS` is a sane default fallback.
 */

/** Default seat allowances by plan tier. Callers SHOULD pass entitlement-derived limits. */
export const SEAT_LIMITS = {
  free: 1,
  starter: 3,
  pro: 10,
  business: 25,
  enterprise: Number.POSITIVE_INFINITY,
} as const;

export type PlanTier = keyof typeof SEAT_LIMITS;

/** Inputs to a seat decision. */
export interface SeatState {
  /** Accepted members currently in the org (includes the owner). */
  readonly activeMembers: number;
  /** Invitations sent but not yet accepted — each reserves a seat. */
  readonly pendingInvites: number;
  /** Total seats the org's plan allows. Use `Infinity` for unlimited. */
  readonly seatLimit: number;
}

/** The verdict for a "can we invite another member?" question. */
export interface SeatVerdict {
  readonly allowed: boolean;
  /** Seats consumed (active + pending). */
  readonly used: number;
  /** Seats remaining (`Infinity` when unlimited; never negative). */
  readonly remaining: number;
  /** Machine-readable reason when `allowed === false`. */
  readonly reason?: 'seat_limit_reached';
}

/**
 * Decide whether one more member may be invited. Pending invites count against
 * the limit (a reserved seat). PURE — same inputs, same output.
 *
 * @param state - {@link SeatState}.
 * @returns A {@link SeatVerdict}.
 *
 * @example
 * canInviteMember({ activeMembers: 2, pendingInvites: 1, seatLimit: 3 })
 * // → { allowed: false, used: 3, remaining: 0, reason: 'seat_limit_reached' }
 */
export function canInviteMember(state: SeatState): SeatVerdict {
  const used = Math.max(0, state.activeMembers) + Math.max(0, state.pendingInvites);
  const remaining = state.seatLimit === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : Math.max(0, state.seatLimit - used);
  const allowed = used < state.seatLimit;
  return allowed
    ? { allowed, used, remaining }
    : { allowed, used, remaining, reason: 'seat_limit_reached' };
}

/**
 * Resolve a plan tier's seat limit, falling back to `free` for unknown tiers.
 *
 * @example
 * seatLimitFor('pro') // 10
 * seatLimitFor('mystery') // 1 (free fallback)
 */
export function seatLimitFor(plan: string): number {
  return SEAT_LIMITS[plan as PlanTier] ?? SEAT_LIMITS.free;
}

/**
 * Convenience: decide an invite from a plan tier + current counts (looks up the
 * seat limit, then delegates to {@link canInviteMember}).
 *
 * @example
 * canInviteForPlan('starter', 2, 0) // { allowed: true, used: 2, remaining: 1 }
 */
export function canInviteForPlan(
  plan: string,
  activeMembers: number,
  pendingInvites: number,
): SeatVerdict {
  return canInviteMember({ activeMembers, pendingInvites, seatLimit: seatLimitFor(plan) });
}
