import {
  evaluateSeats,
  canInviteMember,
  canTransferOwnership,
  transferOwnership,
  resolveSeatLimit,
  countSeatUsage,
} from '../services/team_seats.js';
import type { Env } from '../types/env.js';

/** Mock D1 for COUNT(*) queries: route SQL by table substring → { n }. */
function mockCountEnv(counts: { members: number; invites: number }): Env {
  return {
    DB: {
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => ({
          all: async () => {
            const n = sql.includes('team_invites') ? counts.invites : counts.members;
            return { results: [{ n }] };
          },
        }),
      }),
    },
  } as unknown as Env;
}

/** Mock D1: SELECT role via .first() keyed by user_id (bind arg 1); UPDATE records {role,user} (args 0,2). */
function mockEnv(roles: Record<string, string | undefined>, updates: Array<{ role: string; user: string }>): Env {
  return {
    DB: {
      prepare: (_sql: string) => ({
        bind: (...args: unknown[]) => ({
          all: async () => {
            const role = roles[args[1] as string];
            return { results: role ? [{ role }] : [] };
          },
          run: async () => {
            updates.push({ role: args[0] as string, user: args[2] as string });
            return { meta: { changes: 1 } };
          },
        }),
      }),
    },
  } as unknown as Env;
}

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

describe('resolveSeatLimit', () => {
  it('reads maxTeamSeats from entitlements', () => {
    expect(resolveSeatLimit({ maxTeamSeats: 10 })).toBe(10);
    expect(resolveSeatLimit({ maxTeamSeats: -1 })).toBe(-1);
  });

  it('falls back to a solo seat when entitlement is absent', () => {
    expect(resolveSeatLimit(null)).toBe(1);
    expect(resolveSeatLimit(undefined)).toBe(1);
    expect(resolveSeatLimit({})).toBe(1);
  });
});

describe('countSeatUsage', () => {
  it('counts active members + pending invites from D1', async () => {
    const env = mockCountEnv({ members: 3, invites: 2 });
    await expect(countSeatUsage(env, 'org1')).resolves.toEqual({ activeMembers: 3, pendingInvites: 2 });
  });
});

describe('invite seat-cap enforcement (route policy)', () => {
  it('blocks a new invite once usage reaches the resolved seat limit', async () => {
    // free plan resolves to 1 seat; the owner already fills it
    const env = mockCountEnv({ members: 1, invites: 0 });
    const limit = resolveSeatLimit({ maxTeamSeats: 1 });
    const usage = await countSeatUsage(env, 'org1');
    const decision = canInviteMember(usage, limit);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('Seat limit reached');
  });

  it('allows an invite when the paid plan has seats free', async () => {
    const env = mockCountEnv({ members: 3, invites: 1 });
    const limit = resolveSeatLimit({ maxTeamSeats: 10 });
    const usage = await countSeatUsage(env, 'org1');
    expect(canInviteMember(usage, limit).allowed).toBe(true);
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

describe('transferOwnership', () => {
  it('demotes the owner to admin and promotes the target to owner', async () => {
    const updates: Array<{ role: string; user: string }> = [];
    const env = mockEnv({ u_owner: 'owner', u_member: 'member' }, updates);
    const res = await transferOwnership(env, 'org1', 'u_owner', 'u_member');
    expect(res).toEqual({ ok: true });
    expect(updates).toEqual([
      { role: 'admin', user: 'u_owner' },
      { role: 'owner', user: 'u_member' },
    ]);
  });

  it('refuses when the actor is not the owner (no writes)', async () => {
    const updates: Array<{ role: string; user: string }> = [];
    const env = mockEnv({ u_admin: 'admin', u_member: 'member' }, updates);
    const res = await transferOwnership(env, 'org1', 'u_admin', 'u_member');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('owner');
    expect(updates).toEqual([]);
  });

  it('refuses when the target is not a member (no writes)', async () => {
    const updates: Array<{ role: string; user: string }> = [];
    const env = mockEnv({ u_owner: 'owner' }, updates);
    const res = await transferOwnership(env, 'org1', 'u_owner', 'u_stranger');
    expect(res.ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it('refuses a self-transfer', async () => {
    const updates: Array<{ role: string; user: string }> = [];
    const env = mockEnv({ u_owner: 'owner' }, updates);
    const res = await transferOwnership(env, 'org1', 'u_owner', 'u_owner');
    expect(res.ok).toBe(false);
    expect(updates).toEqual([]);
  });
});
