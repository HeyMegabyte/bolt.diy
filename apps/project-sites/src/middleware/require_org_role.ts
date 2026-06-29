/**
 * @module middleware/require_org_role
 *
 * @description
 * Tenancy guard (#23) for the Better Auth organization plugin. `requireOrgRole`
 * is a Hono middleware that resolves the caller's active-organization role via
 * Better Auth (`auth.api.getActiveMember`) and gates the route on a required
 * role, honoring the hierarchy owner ≥ admin ≥ member. Denial returns **404, not
 * 403** — never leak the existence of a tenant-scoped route (feature-flags
 * doctrine). Ships dark with Better Auth: pre-cutover there are no Better Auth
 * sessions, so it 404s safely; post-cutover it enforces.
 */
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { Env } from '../types/env.js';
// makeAuth is lazy-imported at the callsite — better-auth's ESM dep tree breaks
// jest module-eval; dynamic import keeps it out of the graph until invoked.

/** The org roles defined by the access-control config in `auth/better-auth.ts`. */
export type OrgRole = 'owner' | 'admin' | 'member';

/** Higher number = more privilege. owner ⊃ admin ⊃ member. */
const ROLE_RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

/** Minimal shape of the Better Auth instance this module calls (keeps tests light). */
export interface AuthApiLike {
  readonly api: {
    getActiveMember: (opts: { headers: Headers }) => Promise<{ role?: string } | null>;
  };
}

/**
 * Resolve the caller's active-org role from Better Auth. Never throws — any error
 * (no session, no active org, API failure) resolves to `null`.
 *
 * @param auth - The Better Auth instance (or a stub exposing `api.getActiveMember`).
 * @param headers - The incoming request headers (carry the session cookie/token).
 * @returns The role string, or `null` when there is no active membership.
 *
 * @example
 * const role = await resolveActiveRole(makeAuth(env), req.headers); // 'owner' | null
 */
export async function resolveActiveRole(
  auth: AuthApiLike,
  headers: Headers,
): Promise<string | null> {
  try {
    const member = await auth.api.getActiveMember({ headers });
    return member?.role ?? null;
  } catch {
    return null;
  }
}

/**
 * True when `role` satisfies AT LEAST ONE of `allowed` — by exact match or higher
 * rank (an owner satisfies a `requireOrgRole('admin')` gate). Unknown roles fail.
 *
 * @example
 * roleSatisfies('owner', ['admin']) // true  — owner outranks admin
 * roleSatisfies('member', ['admin']) // false
 */
export function roleSatisfies(role: string | null, allowed: readonly OrgRole[]): boolean {
  if (!role) return false;
  const rank = ROLE_RANK[role as OrgRole];
  if (rank === undefined) return false;
  return allowed.some((a) => rank >= ROLE_RANK[a]);
}

/**
 * Hono middleware enforcing that the caller holds one of `allowed` org roles
 * (or higher). On insufficient/absent role, responds **404** (never 403).
 *
 * @param allowed - One or more roles that pass the gate (lowest acceptable).
 * @returns A Hono `MiddlewareHandler`.
 *
 * @example
 * app.post('/api/org/invite', requireOrgRole('owner', 'admin'), inviteHandler);
 */
export function requireOrgRole(...allowed: OrgRole[]): MiddlewareHandler<{ Bindings: Env }> {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const { makeAuth } = await import('../auth/better-auth.js');
    const auth = makeAuth(c.env) as unknown as AuthApiLike;
    const role = await resolveActiveRole(auth, c.req.raw.headers);
    if (!roleSatisfies(role, allowed)) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    }
    return next();
  };
}
