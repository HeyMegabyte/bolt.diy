/**
 * @module services/workos_provider
 *
 * @description
 * `WorkOsEnterpriseIdentityProvider` — the ENTERPRISE {@link IdentityProvider}
 * (§28/ADR-0006): SSO/SAML for org-scoped logins. WorkOS SSO authorization-code
 * flow, fetch-based (Workers-native). Used only for enterprise orgs; Logto is the
 * default for everyone else. `fetchImpl` injectable for tests.
 *
 * @see platform/identity.ts · services/logto_provider.ts
 */
import {
  IdentityProviderError,
  type AuthCallbackInput,
  type AuthenticatedUser,
  type CreateLoginUrlInput,
  type IdentityProvider,
  type SessionValidationResult,
} from '../platform/identity.js';

const WORKOS_API = 'https://api.workos.com';

export interface WorkOsConfig {
  /** WorkOS API key (the SSO client secret). */
  readonly apiKey: string;
  readonly clientId: string;
  readonly fetchImpl?: typeof fetch;
}

export class WorkOsEnterpriseIdentityProvider implements IdentityProvider {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly cfg: WorkOsConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async createLoginUrl(input: CreateLoginUrlInput): Promise<string> {
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      state: input.state,
    });
    // An org-scoped login routes to that enterprise's SAML/OIDC connection.
    if (input.organizationId) q.set('organization', input.organizationId);
    return `${WORKOS_API}/sso/authorize?${q.toString()}`;
  }

  async handleCallback(input: AuthCallbackInput): Promise<AuthenticatedUser> {
    const res = await this.fetchImpl(`${WORKOS_API}/sso/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.apiKey,
        grant_type: 'authorization_code',
        code: input.code,
      }).toString(),
    });
    if (!res.ok) {
      throw new IdentityProviderError(`workos token exchange ${res.status}`, 'workos');
    }
    const body = (await res.json().catch(() => ({}))) as {
      profile?: {
        id?: string;
        email?: string;
        first_name?: string;
        last_name?: string;
        organization_id?: string;
      };
    };
    const p = body.profile;
    if (!p?.id)
      throw new IdentityProviderError('workos token response missing profile.id', 'workos');
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || null;
    return {
      subject: p.id,
      email: p.email ?? null,
      name,
      provider: 'workos',
      organizationId: p.organization_id ?? null,
    };
  }

  async validateSession(_token: string): Promise<SessionValidationResult> {
    // WorkOS SSO returns the profile only at the code exchange; post-callback the
    // issued D1 session is the source of truth, so there is no token to re-validate.
    return { valid: false, reason: 'workos: validate via the issued D1 session' };
  }

  async logout(redirectUri: string): Promise<string> {
    // WorkOS SSO has no hosted end-session endpoint; clear the D1 session and
    // return the app's post-logout destination.
    return redirectUri;
  }
}
