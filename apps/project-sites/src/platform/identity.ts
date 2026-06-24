/**
 * @module platform/identity
 *
 * @description
 * App-auth identity PORT (convergence §27 Logto + §28 WorkOS, ADR-0006). The
 * port models EXTERNAL identity — "who is this user, proven by an upstream IdP" —
 * via OIDC/SSO. Logto is the DEFAULT consumer-auth provider; WorkOS handles
 * ENTERPRISE SSO/SAML/SCIM. After {@link IdentityProvider.handleCallback}
 * returns a verified {@link AuthenticatedUser}, the EXISTING D1 session machinery
 * (auth.findOrCreateUser → auth.createSession) issues our own session — so the
 * IdP replaces "how the user proves identity" (magic-link/Google), not the
 * session model.
 *
 * Ports-and-adapters: real LogtoIdentityProvider / WorkOsEnterpriseIdentityProvider
 * sit behind the `LOGTO_*` / `WORKOS_*` env gates; with neither configured the
 * factory returns null and the existing custom auth (magic-link + Google OAuth)
 * remains the live path. Ships dark — enabling Logto is a config flip.
 *
 * @see services/logto_provider.ts · services/workos_provider.ts
 * @see middleware/identity.ts (getIdentityProvider factory)
 * @see docs/adr/0006-logto-default-auth-workos-enterprise-only.md
 */

/** A verified external identity from an IdP. */
export interface AuthenticatedUser {
  /** Stable IdP subject id (the `sub` claim). */
  readonly subject: string;
  readonly email: string | null;
  readonly name: string | null;
  /** Which IdP authenticated them. */
  readonly provider: 'logto' | 'workos';
  /** Enterprise org id (WorkOS), when the login was org-scoped. */
  readonly organizationId?: string | null;
}

export interface CreateLoginUrlInput {
  readonly redirectUri: string;
  /** Opaque CSRF/anti-forgery state echoed back to the callback. */
  readonly state: string;
  /** WorkOS: org/connection to route an enterprise login. */
  readonly organizationId?: string | null;
}

export interface AuthCallbackInput {
  readonly code: string;
  readonly redirectUri: string;
}

export interface SessionValidationResult {
  readonly valid: boolean;
  readonly user?: AuthenticatedUser;
  readonly reason?: string;
}

/** The app-auth identity port (§27/§28). */
export interface IdentityProvider {
  /** Build the IdP authorize URL to redirect the user to. */
  createLoginUrl(input: CreateLoginUrlInput): Promise<string>;
  /** Exchange the callback `code` for a verified {@link AuthenticatedUser}. */
  handleCallback(input: AuthCallbackInput): Promise<AuthenticatedUser>;
  /** Validate an IdP access/id token (e.g. for token-bearing API calls). */
  validateSession(token: string): Promise<SessionValidationResult>;
  /** Build the IdP end-session URL. */
  logout(redirectUri: string): Promise<string>;
}

/** Error raised by an IdP adapter on a non-2xx / malformed upstream response. */
export class IdentityProviderError extends Error {
  constructor(
    message: string,
    readonly provider: 'logto' | 'workos',
  ) {
    super(message);
    this.name = 'IdentityProviderError';
  }
}

/**
 * Deterministic provider for tests + no-vendor local mode. Returns a fixed user
 * from `handleCallback` and a stub authorize URL.
 */
export class FakeIdentityProvider implements IdentityProvider {
  constructor(private readonly user: AuthenticatedUser) {}
  async createLoginUrl(input: CreateLoginUrlInput): Promise<string> {
    return `https://fake-idp.test/authorize?state=${encodeURIComponent(input.state)}`;
  }
  async handleCallback(): Promise<AuthenticatedUser> {
    return this.user;
  }
  async validateSession(token: string): Promise<SessionValidationResult> {
    return token ? { valid: true, user: this.user } : { valid: false, reason: 'no token' };
  }
  async logout(redirectUri: string): Promise<string> {
    return `https://fake-idp.test/logout?post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`;
  }
}
