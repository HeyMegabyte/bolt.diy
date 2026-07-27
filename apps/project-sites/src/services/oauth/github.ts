/**
 * GitHub OAuth native adapter — token lifecycle for GitHub API.
 *
 * @remarks
 * Uses project-level GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET secrets.
 * Scopes default to read:user user:email. Lazy-loaded by Capability Router.
 */
import type { NativeOAuthAdapter, OAuthToken } from './index.js';

const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

const DEFAULT_SCOPES = ['read:user', 'user:email'];

export class GitHubOAuthAdapter implements NativeOAuthAdapter {
  readonly provider = 'github';

  private readonly clientId?: string;
  private readonly clientSecret?: string;

  constructor(env: { GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string }) {
    this.clientId = env.GITHUB_CLIENT_ID;
    this.clientSecret = env.GITHUB_CLIENT_SECRET;
  }

  authorizeUrl(redirectUri: string, state: string): string {
    if (!this.clientId) throw new Error('GITHUB_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: DEFAULT_SCOPES.join(' '),
      state,
    });
    return `${GITHUB_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthToken | null> {
    if (!this.clientId || !this.clientSecret) return null;
    const res = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const accessToken = data.access_token ? String(data.access_token) : null;
    if (!accessToken) return null;
    return {
      accessToken,
      scopes: String(data.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    };
  }

  async refreshToken(_refreshToken: string): Promise<OAuthToken | null> {
    // GitHub tokens don't expire unless revoked — no refresh flow
    return null;
  }

  async revokeToken(accessToken: string): Promise<boolean> {
    if (!this.clientId || !this.clientSecret) return false;
    const res = await fetch(
      `https://api.github.com/applications/${this.clientId}/grant`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${btoa(`${this.clientId}:${this.clientSecret}`)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
    return res.status === 204;
  }
}
