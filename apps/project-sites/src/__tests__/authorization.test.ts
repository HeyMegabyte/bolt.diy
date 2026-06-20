/**
 * Convergence §29 — authorization model (default deny).
 *
 * Exercises the canonical §29 cases against the in-memory graph + asserts the
 * fail-closed DenyAll default.
 */
import {
  FakeAuthorizationProvider,
  DenyAllAuthorizationProvider,
  type AuthorizationCheckInput,
} from '../platform/authorization.js';

async function grant(p: FakeAuthorizationProvider, user: string, relation: string, object: string) {
  await p.writeRelationship({ user, relation, object });
}
const can = (user: string, relation: string, object: string): AuthorizationCheckInput => ({ user, relation, object });

describe('FakeAuthorizationProvider (§29 model)', () => {
  it('owner can publish + manage billing + manage api keys', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'owner1', 'owner', 'site:a');
    expect(await p.check(can('owner1', 'can_publish', 'site:a'))).toBe(true);
    expect(await p.check(can('owner1', 'can_manage_billing', 'site:a'))).toBe(true);
    expect(await p.check(can('owner1', 'can_manage_api_keys', 'site:a'))).toBe(true);
  });

  it('editor can edit but CANNOT manage billing or publish', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'ed1', 'editor', 'site:a');
    expect(await p.check(can('ed1', 'can_edit', 'site:a'))).toBe(true);
    expect(await p.check(can('ed1', 'can_manage_billing', 'site:a'))).toBe(false);
    expect(await p.check(can('ed1', 'can_publish', 'site:a'))).toBe(false);
  });

  it('viewer can view but cannot mutate', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'v1', 'viewer', 'site:a');
    expect(await p.check(can('v1', 'can_view', 'site:a'))).toBe(true);
    expect(await p.check(can('v1', 'can_edit', 'site:a'))).toBe(false);
  });

  it('agency can manage its ASSIGNED client site only', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'agency1', 'agency', 'site:a');
    expect(await p.check(can('agency1', 'can_edit', 'site:a'))).toBe(true);
    expect(await p.check(can('agency1', 'can_edit', 'site:b'))).toBe(false); // not assigned
  });

  it('a site-scoped API key reaches only its scoped site', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'key:psk_1', 'editor', 'site:a');
    expect(await p.check(can('key:psk_1', 'can_edit', 'site:a'))).toBe(true);
    expect(await p.check(can('key:psk_1', 'can_edit', 'site:b'))).toBe(false);
  });

  it('platform admin can perform a platform action', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'admin1', 'platform_admin', 'platform');
    expect(await p.check(can('admin1', 'platform_action', 'platform'))).toBe(true);
    expect(await p.check(can('nobody', 'platform_action', 'platform'))).toBe(false);
  });

  it('default deny: unknown user / unknown permission', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'owner1', 'owner', 'site:a');
    expect(await p.check(can('stranger', 'can_view', 'site:a'))).toBe(false);
    expect(await p.check(can('owner1', 'made_up_permission', 'site:a'))).toBe(false);
  });

  it('deleteRelationship revokes access; listObjects enumerates grants', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'owner1', 'owner', 'site:a');
    await grant(p, 'owner1', 'owner', 'site:b');
    expect((await p.listObjects({ user: 'owner1', relation: 'can_publish' })).sort()).toEqual(['site:a', 'site:b']);
    await p.deleteRelationship({ user: 'owner1', relation: 'owner', object: 'site:a' });
    expect(await p.check(can('owner1', 'can_publish', 'site:a'))).toBe(false);
    expect(await p.check(can('owner1', 'can_publish', 'site:b'))).toBe(true);
  });

  it('batchCheck mirrors per-check results', async () => {
    const p = new FakeAuthorizationProvider();
    await grant(p, 'owner1', 'owner', 'site:a');
    expect(await p.batchCheck([can('owner1', 'can_publish', 'site:a'), can('owner1', 'can_publish', 'site:z')])).toEqual([true, false]);
  });
});

describe('DenyAllAuthorizationProvider (fail-closed default)', () => {
  it('denies everything', async () => {
    const p = new DenyAllAuthorizationProvider();
    expect(await p.check(can('owner1', 'can_view', 'site:a'))).toBe(false);
    expect(await p.batchCheck([can('x', 'y', 'z')])).toEqual([false]);
    expect(await p.listObjects({ user: 'owner1', relation: 'can_view' })).toEqual([]);
  });
});
