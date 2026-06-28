/**
 * org_seats — seat-enforcement logic (#25). Locks the pending-invites-reserve-a-seat
 * rule, the plan→limit mapping, and the unlimited (enterprise) path.
 */
import {
  canInviteMember,
  canInviteForPlan,
  seatLimitFor,
  SEAT_LIMITS,
} from '../services/org_seats.js';

describe('canInviteMember', () => {
  it('allows an invite with seats to spare', () => {
    const v = canInviteMember({ activeMembers: 1, pendingInvites: 0, seatLimit: 3 });
    expect(v.allowed).toBe(true);
    expect(v.used).toBe(1);
    expect(v.remaining).toBe(2);
  });

  it('counts pending invitations against the limit (the reservation rule)', () => {
    const v = canInviteMember({ activeMembers: 2, pendingInvites: 1, seatLimit: 3 });
    expect(v.allowed).toBe(false);
    expect(v.used).toBe(3);
    expect(v.remaining).toBe(0);
    expect(v.reason).toBe('seat_limit_reached');
  });

  it('blocks once active members alone fill the plan', () => {
    const v = canInviteMember({ activeMembers: 3, pendingInvites: 0, seatLimit: 3 });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('seat_limit_reached');
  });

  it('never reports negative remaining when over-subscribed', () => {
    const v = canInviteMember({ activeMembers: 5, pendingInvites: 2, seatLimit: 3 });
    expect(v.remaining).toBe(0);
    expect(v.allowed).toBe(false);
  });

  it('allows unlimited seats (enterprise / Infinity)', () => {
    const v = canInviteMember({ activeMembers: 999, pendingInvites: 50, seatLimit: Infinity });
    expect(v.allowed).toBe(true);
    expect(v.remaining).toBe(Infinity);
  });
});

describe('seatLimitFor + canInviteForPlan', () => {
  it('maps known tiers', () => {
    expect(seatLimitFor('pro')).toBe(SEAT_LIMITS.pro);
    expect(seatLimitFor('enterprise')).toBe(Infinity);
  });
  it('falls back to free for unknown tiers', () => {
    expect(seatLimitFor('mystery')).toBe(SEAT_LIMITS.free);
  });
  it('decides directly from a plan tier', () => {
    expect(canInviteForPlan('starter', 2, 0).allowed).toBe(true);
    expect(canInviteForPlan('free', 1, 0).allowed).toBe(false);
  });
});
