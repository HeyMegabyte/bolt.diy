/**
 * @module middleware/identity
 *
 * @description
 * `getIdentityProvider(env, opts)` — selects the app-auth IdP per ADR-0006:
 * Logto is the DEFAULT; WorkOS handles ENTERPRISE org-scoped logins. Returns
 * `null` when neither is configured, in which case the existing custom auth
 * (magic-link + Google OAuth + D1 sessions) remains the live path — so enabling
 * Logto/WorkOS is a config flip that ships dark.
 *
 * @see platform/identity.ts · services/logto_provider.ts · services/workos_provider.ts
 */
import type { Env } from '../types/env.js';
import type { IdentityProvider } from '../platform/identity.js';
import { LogtoIdentityProvider } from '../services/logto_provider.js';
import { WorkOsEnterpriseIdentityProvider } from '../services/workos_provider.js';

export interface IdentityDeps {
  readonly provider?: IdentityProvider;
  /** True for an enterprise org-scoped login → prefer WorkOS when configured. */
  readonly enterprise?: boolean;
}

/**
 * Resolve the IdP: WorkOS for enterprise (when configured), else Logto (default),
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

  if (env.LOGTO_ENDPOINT && env.LOGTO_APP_ID && env.LOGTO_APP_SECRET) {
    return new LogtoIdentityProvider({
      endpoint: env.LOGTO_ENDPOINT,
      appId: env.LOGTO_APP_ID,
      appSecret: env.LOGTO_APP_SECRET,
    });
  }

  return null;
}
