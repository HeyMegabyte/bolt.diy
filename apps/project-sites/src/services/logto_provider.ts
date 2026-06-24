/**
 * @module services/logto_provider
 *
 * @description
 * `LogtoIdentityProvider` — the DEFAULT consumer-auth {@link IdentityProvider}
 * (§27/ADR-0006). Standard OIDC authorization-code flow against a Logto tenant,
 * fetch-based (Workers-native, no SDK). `fetchImpl` is injectable for tests.
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

export interface LogtoConfig {
  /** Logto tenant endpoint, e.g. https://xxxx.logto.app. */
  readonly endpoint: string;
  readonly appId: string;
  readonly appSecret: string;
  readonly fetchImpl?: typeof fetch;
}

export class LogtoIdentityProvider implements IdentityProvider {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly cfg: LogtoConfig) {
    this.base = cfg.endpoint.replace(/\/+$/, '');
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async createLoginUrl(input: CreateLoginUrlInput): Promise<string> {
    const q = new URLSearchParams({
      client_id: this.cfg.appId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state: input.state,
    });
    return `${this.base}/oidc/auth?${q.toString()}`;
  }

  async handleCallback(input: AuthCallbackInput): Promise<AuthenticatedUser> {
    const tokenRes = await this.fetchImpl(`${this.base}/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        client_id: this.cfg.appId,
        client_secret: this.cfg.appSecret,
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new IdentityProviderError(`logto token exchange ${tokenRes.status}`, 'logto');
    }
    const tokens = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokens.access_token) {
      throw new IdentityProviderError('logto token response missing access_token', 'logto');
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
    const q = new URLSearchParams({
      client_id: this.cfg.appId,
      post_logout_redirect_uri: redirectUri,
    });
    return `${this.base}/oidc/session/end?${q.toString()}`;
  }

  /** Resolve the OIDC userinfo from an access token → normalized user. */
  private async userFromAccessToken(accessToken: string): Promise<AuthenticatedUser> {
    const res = await this.fetchImpl(`${this.base}/oidc/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new IdentityProviderError(`logto userinfo ${res.status}`, 'logto');
    const me = (await res.json().catch(() => ({}))) as {
      sub?: string;
      email?: string;
      name?: string;
      username?: string;
    };
    if (!me.sub) throw new IdentityProviderError('logto userinfo missing sub', 'logto');
    return {
      subject: me.sub,
      email: me.email ?? null,
      name: me.name ?? me.username ?? null,
      provider: 'logto',
    };
  }
}
