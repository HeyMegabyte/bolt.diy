import {
  evaluateSeats,
  canInviteMember,
  canTransferOwnership,
} from '../services/team_seats.js';

describe('evaluateSeats', () => {
  it('counts active members + pending invites against the limit', () => {
    const a = evaluateSeats({ activeMembers: 3, pendingInvites: 1 }, 5);
    expect(a.used).toBe(4);
    expect(a.remaining).toBe(1);
    expect(a.full).toBe(false);
  });

  it('is full when used meets the limit', () => {
    const a = evaluateSeats({ activeMembers: 4, pendingInvites: 1 }, 5);
    expect(a.used).toBe(5);
    expect(a.remaining).toBe(0);
    expect(a.full).toBe(true);
  });

  it('treats a negative limit as unlimited', () => {
    const a = evaluateSeats({ activeMembers: 50, pendingInvites: 10 }, -1);
    expect(a.full).toBe(false);
    expect(a.remaining).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('canInviteMember', () => {
  it('allows an invite with seats remaining', () => {
    expect(canInviteMember({ activeMembers: 2, pendingInvites: 0 }, 5)).toEqual({ allowed: true, remaining: 3 });
  });

  it('blocks an invite at the seat cap with a reason', () => {
    const d = canInviteMember({ activeMembers: 5, pendingInvites: 0 }, 5);
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
    expect(d.reason).toContain('Seat limit reached');
  });

  it('always allows under an unlimited plan', () => {
    expect(canInviteMember({ activeMembers: 999, pendingInvites: 0 }, -1).allowed).toBe(true);
  });
});

describe('canTransferOwnership', () => {
  it('lets the owner transfer to an existing member', () => {
    expect(canTransferOwnership('owner', true)).toEqual({ allowed: true });
  });

  it('refuses a non-owner', () => {
    expect(canTransferOwnership('admin', true).allowed).toBe(false);
    expect(canTransferOwnership('member', true).allowed).toBe(false);
  });

  it('refuses transfer to a non-member', () => {
    const d = canTransferOwnership('owner', false);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('existing team member');
  });
});
