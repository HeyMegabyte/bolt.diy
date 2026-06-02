/**
 * @module services/team_seats
 * @description Seat-limit + ownership-transfer policy for Team Seats & RBAC
 * (build-first module #8, P1).
 *
 * IMPORTANT (dedup): team membership already exists — `ROLES` + RBAC in
 * `@project-sites/shared`, the `team_invites` table + `GET /api/team/members`
 * + `POST /api/team/invites` in `routes/ai_admin.ts`. #8 EXTENDS that; it is
 * NOT a new module. The genuine gaps this fills: (1) the invite flow does not
 * enforce a seat CAP, and (2) there is no ownership-transfer guard. These are
 * the pure policy functions the existing invite/owner routes should adopt.
 *
 * Pure + deterministic (the seat limit + counts are passed in — the route
 * resolves them from plan entitlements + D1) so the rules are unit-testable.
 *
 * @packageDocumentation
 */

/** A seat limit `< 0` means unlimited (e.g. enterprise). */
export interface SeatUsage {
  activeMembers: number;
  pendingInvites: number;
}

export interface SeatAvailability {
  used: number;
  limit: number;
  /** `Number.POSITIVE_INFINITY` when the limit is unlimited (`limit < 0`). */
  remaining: number;
  full: boolean;
}

/** Active members + outstanding invites both consume a seat. */
export function evaluateSeats(usage: SeatUsage, seatLimit: number): SeatAvailability {
  const used = Math.max(0, usage.activeMembers) + Math.max(0, usage.pendingInvites);
  const unlimited = seatLimit < 0;
  const remaining = unlimited ? Number.POSITIVE_INFINITY : Math.max(0, seatLimit - used);
  return { used, limit: seatLimit, remaining, full: !unlimited && used >= seatLimit };
}

export interface InviteDecision {
  allowed: boolean;
  remaining: number;
  reason?: string;
}

/** Whether one more invite/member fits under the seat cap. */
export function canInviteMember(usage: SeatUsage, seatLimit: number): InviteDecision {
  const a = evaluateSeats(usage, seatLimit);
  if (a.full) {
    return {
      allowed: false,
      remaining: 0,
      reason: `Seat limit reached (${seatLimit}). Remove a member or upgrade your plan to invite more.`,
    };
  }
  return { allowed: true, remaining: a.remaining };
}

export interface TransferDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Only the current owner may transfer ownership, and only to an existing
 * team member (you can't hand the org to a stranger). The route still
 * re-checks membership against D1 — this guards the decision shape.
 */
export function canTransferOwnership(actorRole: string, targetIsMember: boolean): TransferDecision {
  if (actorRole !== 'owner') return { allowed: false, reason: 'Only the owner can transfer ownership' };
  if (!targetIsMember) return { allowed: false, reason: 'Ownership can only be transferred to an existing team member' };
  return { allowed: true };
}
