/**
 * @module middleware/identity
 *
 * @description
 * `getIdentityProvider(env, opts)` — selects the app-auth IdP per ADR-0006:
 * Better Auth is the DEFAULT; WorkOS handles ENTERPRISE org-scoped logins. Returns
 * `null` when neither is configured, in which case the existing custom auth
 * (magic-link + Google OAuth + D1 sessions) remains the live path — so enabling Better Auth/WorkOS is a config flip that ships dark.
 *
 * @see platform/identity.ts · services/better_auth_provider.ts · services/workos_provider.ts
 */
import type { Env } from '../types/env.js';
import type { IdentityProvider } from '../platform/identity.js';
import { BetterAuthIdentityProvider } from '../services/better_auth_provider.js';
import { WorkOsEnterpriseIdentityProvider } from '../services/workos_provider.js';

export interface IdentityDeps {
  readonly provider?: IdentityProvider;
  /** True for an enterprise org-scoped login → prefer WorkOS when configured. */
  readonly enterprise?: boolean;
}

/**
 * Resolve the IdP: WorkOS for enterprise (when configured), else Better Auth (default),
 * else null (custom auth stays live).
 *
 * @example
 * const idp = getIdentityProvider(c.env);
 * if (idp) return c.redirect(await idp.createLoginUrl({ redirectUri, state }));
 * // else fall back to the magic-link / Google flow.
 */
export function getIdentityProvider(env: Env, deps: IdentityDeps = {}): IdentityProvider | null {
  if (deps.provider) return deps.provider;

  if (deps.enterprise && env.WORKOS_API_KEY && env.WORKOS_CLIENT_ID) {
    return new WorkOsEnterpriseIdentityProvider({
      apiKey: env.WORKOS_API_KEY,
      clientId: env.WORKOS_CLIENT_ID,
    });
  }

  if (env.BETTER_AUTH_URL && env.BETTER_AUTH_CLIENT_ID && env.BETTER_AUTH_CLIENT_SECRET) {
    return new BetterAuthIdentityProvider({
      baseUrl: env.BETTER_AUTH_URL,
      clientId: env.BETTER_AUTH_CLIENT_ID,
      clientSecret: env.BETTER_AUTH_CLIENT_SECRET,
    });
  }

  return null;
}
