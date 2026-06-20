/**
 * @module services/authz_bootstrap
 *
 * @description
 * Relationship bootstrap (§29/ADR-0005): write the authorization tuples that make
 * `requireAuthz` meaningful. Call `grantSiteOwner` when a site is created/claimed,
 * `grantSiteRole`/`revokeSiteRole` when membership changes. Uses the canonical
 * subject naming so writes match the checks.
 *
 * Fail-soft: a write failure is logged but does NOT block the create flow
 * (progressive-degradation, §58) — reconcile rather than reject the user's action.
 * When OpenFGA is unconfigured, `getAuthorizationProvider` returns DenyAll whose
 * write is a no-op, so bootstrap is inert until OpenFGA is live.
 *
 * @see docs/adr/0005-openfga-authorization-graph.md
 */

import type { Env } from '../types/env.js';
import { getAuthorizationProvider, type AuthzDeps } from '../middleware/authz.js';
import { userSubject, siteResource } from '../platform/authz-subjects.js';

/** Grant `user` a role on a site (write a relationship tuple). Fail-soft. */
export async function grantSiteRole(
  env: Env,
  input: { userId: string; siteId: string; role: 'owner' | 'editor' | 'viewer' | 'agency' },
  deps: AuthzDeps = {},
): Promise<void> {
  try {
    await getAuthorizationProvider(env, deps).writeRelationship({
      user: userSubject(input.userId),
      relation: input.role,
      object: siteResource(input.siteId),
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'authz_bootstrap',
        message: 'grantSiteRole failed (reconcile later)',
        role: input.role,
        siteId: input.siteId,
        error: String(err),
      }),
    );
  }
}

/** Convenience: make `userId` the owner of `siteId` (call on site create/claim). */
export function grantSiteOwner(env: Env, userId: string, siteId: string, deps: AuthzDeps = {}): Promise<void> {
  return grantSiteRole(env, { userId, siteId, role: 'owner' }, deps);
}

/** Revoke a role tuple (call on membership removal). Fail-soft. */
export async function revokeSiteRole(
  env: Env,
  input: { userId: string; siteId: string; role: 'owner' | 'editor' | 'viewer' | 'agency' },
  deps: AuthzDeps = {},
): Promise<void> {
  try {
    await getAuthorizationProvider(env, deps).deleteRelationship({
      user: userSubject(input.userId),
      relation: input.role,
      object: siteResource(input.siteId),
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'authz_bootstrap',
        message: 'revokeSiteRole failed (reconcile later)',
        role: input.role,
        siteId: input.siteId,
        error: String(err),
      }),
    );
  }
}
