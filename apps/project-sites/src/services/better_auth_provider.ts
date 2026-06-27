/**
 * @module services/better_auth_provider
 *
 * @description
 * `BetterAuthIdentityProvider` — the DEFAULT consumer-auth {@link IdentityProvider}
 * (§27/ADR-0006). Standard OIDC authorization-code flow against a self-hosted
 * Better Auth instance (its `oidcProvider` plugin), fetch-based (Workers-native,
 * no SDK). Better Auth runs at `auth.projectsites.dev` on Neon Postgres — unlike
 * Logto it needs no Postgres role-password control, so it runs on Neon natively.
 * `fetchImpl` is injectable for tests.
 *
 * @see platform/identity.ts
 */
import {
  IdentityProviderError,
  type AuthCallbackInput,
  type AuthenticatedUser,
  type CreateLoginUrlInput,
  type IdentityProvider,
  type SessionValidationResult,
} from '../platform/identity.js';

export interface BetterAuthConfig {
  /** Better Auth base URL, e.g. https://auth.projectsites.dev. */
  readonly baseUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl?: typeof fetch;
}

export class BetterAuthIdentityProvider implements IdentityProvider {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly cfg: BetterAuthConfig) {
    this.base = cfg.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async createLoginUrl(input: CreateLoginUrlInput): Promise<string> {
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state: input.state,
    });
    return `${this.base}/api/auth/oauth2/authorize?${q.toString()}`;
  }

  async handleCallback(input: AuthCallbackInput): Promise<AuthenticatedUser> {
    const tokenRes = await this.fetchImpl(`${this.base}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new IdentityProviderError(`better-auth token exchange ${tokenRes.status}`, 'betterauth');
    }
    const tokens = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokens.access_token) {
      throw new IdentityProviderError('better-auth token response missing access_token', 'betterauth');
    }
    return this.userFromAccessToken(tokens.access_token);
  }

  async validateSession(token: string): Promise<SessionValidationResult> {
    if (!token) return { valid: false, reason: 'no token' };
    try {
      const user = await this.userFromAccessToken(token);
      return { valid: true, user };
    } catch (err) {
      return { valid: false, reason: err instanceof Error ? err.message : 'invalid' };
    }
  }

  async logout(redirectUri: string): Promise<string> {
    const q = new URLSearchParams({ redirect: redirectUri });
    return `${this.base}/api/auth/sign-out?${q.toString()}`;
  }

  /** Resolve the OIDC userinfo from an access token → normalized user. */
  private async userFromAccessToken(accessToken: string): Promise<AuthenticatedUser> {
    const res = await this.fetchImpl(`${this.base}/api/auth/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new IdentityProviderError(`better-auth userinfo ${res.status}`, 'betterauth');
    const me = (await res.json().catch(() => ({}))) as {
      sub?: string;
      email?: string;
      name?: string;
      username?: string;
    };
    if (!me.sub) throw new IdentityProviderError('better-auth userinfo missing sub', 'betterauth');
    return {
      subject: me.sub,
      email: me.email ?? null,
      name: me.name ?? me.username ?? null,
      provider: 'betterauth',
    };
  }
}
