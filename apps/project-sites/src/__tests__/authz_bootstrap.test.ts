/**
 * Convergence §29/ADR-0005 — relationship bootstrap.
 *
 * grantSiteOwner writes the owner tuple so requireAuthz('can_publish') passes;
 * the write uses the canonical subject form; failures are fail-soft (no throw).
 */
import { grantSiteOwner, grantSiteRole, revokeSiteRole } from '../services/authz_bootstrap.js';
import { FakeAuthorizationProvider } from '../platform/authorization.js';
import { userSubject, siteResource } from '../platform/authz-subjects.js';
import type { Env } from '../types/env.js';
import type { AuthorizationProvider } from '../platform/authorization.js';

const env = {} as Env;

describe('authz bootstrap', () => {
  it('grantSiteOwner writes user:<id> owner site:<id> → requireAuthz can_publish passes', async () => {
    const p = new FakeAuthorizationProvider();
    await grantSiteOwner(env, 'u1', 's1', { provider: p });
    expect(
      await p.check({
        user: userSubject('u1'),
        relation: 'can_publish',
        object: siteResource('s1'),
      }),
    ).toBe(true);
    // a different user has nothing
    expect(
      await p.check({ user: userSubject('u2'), relation: 'can_view', object: siteResource('s1') }),
    ).toBe(false);
  });

  it('grantSiteRole(editor) grants edit but not publish; revoke removes it', async () => {
    const p = new FakeAuthorizationProvider();
    await grantSiteRole(env, { userId: 'u1', siteId: 's1', role: 'editor' }, { provider: p });
    expect(
      await p.check({ user: userSubject('u1'), relation: 'can_edit', object: siteResource('s1') }),
    ).toBe(true);
    expect(
      await p.check({
        user: userSubject('u1'),
        relation: 'can_publish',
        object: siteResource('s1'),
      }),
    ).toBe(false);
    await revokeSiteRole(env, { userId: 'u1', siteId: 's1', role: 'editor' }, { provider: p });
    expect(
      await p.check({ user: userSubject('u1'), relation: 'can_edit', object: siteResource('s1') }),
    ).toBe(false);
  });

  it('is fail-soft: a provider write error never throws (does not block create)', async () => {
    const throwing: AuthorizationProvider = {
      async check() {
        return false;
      },
      async batchCheck() {
        return [];
      },
      async writeRelationship() {
        throw new Error('openfga down');
      },
      async deleteRelationship() {
        throw new Error('openfga down');
      },
      async listObjects() {
        return [];
      },
    };
    await expect(grantSiteOwner(env, 'u1', 's1', { provider: throwing })).resolves.toBeUndefined();
    await expect(
      revokeSiteRole(env, { userId: 'u1', siteId: 's1', role: 'owner' }, { provider: throwing }),
    ).resolves.toBeUndefined();
  });
});
