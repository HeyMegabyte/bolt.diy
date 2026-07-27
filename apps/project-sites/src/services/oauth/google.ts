/**
 * Google OAuth native adapter — token lifecycle for Google APIs.
 *
 * @remarks
 * Uses the existing project-level GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET secrets.
 * Scopes default to openid profile email. The adapter is loaded lazily by the
 * Capability Router — it never blocks startup on missing secrets.
 */
import type { NativeOAuthAdapter, OAuthToken } from './index.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const DEFAULT_SCOPES = ['openid', 'profile', 'email'];

export class GoogleOAuthAdapter implements NativeOAuthAdapter {
  readonly provider = 'google';

  private readonly clientId?: string;
  private readonly clientSecret?: string;

  constructor(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }) {
    this.clientId = env.GOOGLE_CLIENT_ID;
    this.clientSecret = env.GOOGLE_CLIENT_SECRET;
  }

  authorizeUrl(redirectUri: string, state: string): string {
    if (!this.clientId) throw new Error('GOOGLE_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: DEFAULT_SCOPES.join(' '),
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthToken | null> {
    if (!this.clientId || !this.clientSecret) return null;
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      accessToken: String(data.access_token ?? ''),
      refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
      expiresAt: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : undefined,
      scopes: String(data.scope ?? '').split(' ').filter(Boolean),
    };
  }

  async refreshToken(refreshToken: string): Promise<OAuthToken | null> {
    if (!this.clientId || !this.clientSecret) return null;
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return {
      accessToken: String(data.access_token ?? ''),
      expiresAt: typeof data.expires_in === 'number' ? Date.now() + data.expires_in * 1000 : undefined,
      scopes: String(data.scope ?? '').split(' ').filter(Boolean),
    };
  }

  async revokeToken(accessToken: string): Promise<boolean> {
    const res = await fetch(GOOGLE_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: accessToken }),
    });
    return res.ok;
  }
}
