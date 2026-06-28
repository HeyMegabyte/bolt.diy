/**
 * require_org_role — tenancy guard (#23). Locks the role-rank logic, the
 * resolve-never-throws contract, and the 404-on-deny middleware behavior.
 */
let activeMember: { role?: string } | null = null;
let getActiveMemberThrows = false;
jest.mock('../auth/better-auth.js', () => ({
  makeAuth: () => ({
    api: {
      getActiveMember: async () => {
        if (getActiveMemberThrows) throw new Error('no session');
        return activeMember;
      },
    },
  }),
}));

import {
  resolveActiveRole,
  roleSatisfies,
  requireOrgRole,
} from '../middleware/require_org_role.js';

describe('roleSatisfies (hierarchy owner ≥ admin ≥ member)', () => {
  it('exact match passes', () => {
    expect(roleSatisfies('member', ['member'])).toBe(true);
    expect(roleSatisfies('admin', ['admin'])).toBe(true);
  });
  it('higher rank satisfies a lower requirement', () => {
    expect(roleSatisfies('owner', ['admin'])).toBe(true);
    expect(roleSatisfies('owner', ['member'])).toBe(true);
    expect(roleSatisfies('admin', ['member'])).toBe(true);
  });
  it('lower rank does NOT satisfy a higher requirement', () => {
    expect(roleSatisfies('member', ['admin'])).toBe(false);
    expect(roleSatisfies('admin', ['owner'])).toBe(false);
  });
  it('null or unknown role never satisfies', () => {
    expect(roleSatisfies(null, ['member'])).toBe(false);
    expect(roleSatisfies('superuser', ['member'])).toBe(false);
  });
});

describe('resolveActiveRole (never throws)', () => {
  const authWith = (member: { role?: string } | null, throws = false) => ({
    api: {
      getActiveMember: async () => {
        if (throws) throw new Error('boom');
        return member;
      },
    },
  });
  it('returns the member role', async () => {
    expect(await resolveActiveRole(authWith({ role: 'owner' }) as never, new Headers())).toBe(
      'owner',
    );
  });
  it('returns null when there is no active member', async () => {
    expect(await resolveActiveRole(authWith(null) as never, new Headers())).toBeNull();
  });
  it('returns null (never throws) when the API throws', async () => {
    expect(await resolveActiveRole(authWith(null, true) as never, new Headers())).toBeNull();
  });
});

describe('requireOrgRole middleware', () => {
  function run(role: string | null, allowed: ('owner' | 'admin' | 'member')[], throws = false) {
    activeMember = role === null ? null : { role };
    getActiveMemberThrows = throws;
    const calls = { next: 0, jsonStatus: 0 as number };
    const c = {
      env: {},
      req: { raw: { headers: new Headers() } },
      json: (_body: unknown, status: number) => {
        calls.jsonStatus = status;
        return { status };
      },
    } as never;
    const next = async () => {
      calls.next += 1;
    };
    return requireOrgRole(...allowed)(c, next).then(() => calls);
  }

  it('calls next() when the caller satisfies the gate (owner on owner gate)', async () => {
    const r = await run('owner', ['owner']);
    expect(r.next).toBe(1);
    expect(r.jsonStatus).toBe(0);
  });

  it('calls next() when the caller outranks the gate (owner on admin gate)', async () => {
    const r = await run('owner', ['admin']);
    expect(r.next).toBe(1);
  });

  it('returns 404 (never 403) when the caller lacks the role', async () => {
    const r = await run('member', ['admin']);
    expect(r.next).toBe(0);
    expect(r.jsonStatus).toBe(404);
  });

  it('returns 404 when there is no active membership', async () => {
    const r = await run(null, ['member']);
    expect(r.next).toBe(0);
    expect(r.jsonStatus).toBe(404);
  });

  it('returns 404 (never throws) when Better Auth errors', async () => {
    const r = await run(null, ['member'], true);
    expect(r.jsonStatus).toBe(404);
  });
});
