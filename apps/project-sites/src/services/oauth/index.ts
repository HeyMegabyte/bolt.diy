/**
 * @module services/oauth
 *
 * Native OAuth provider adapters — replaces Nango (removed ADR-0034, 2026-07-27).
 * Each provider gets a typed adapter for connection lifecycle: authorize, callback,
 * token exchange, refresh, revoke. AES-GCM encrypted tokens stored in D1
 * `mcp_connections` table via `mcp_oauth.ts`.
 *
 * Capability Router: Native → Composio (fallback) → unsupported.
 */

export type OAuthProvider = string;

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
}

export interface OAuthConnection {
  provider: OAuthProvider;
  token: OAuthToken;
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
  updatedAt: string;
}

/**
 * Adapter contract every native OAuth provider implements.
 * Returns null for unsupported operations, never throws.
 */
export interface NativeOAuthAdapter {
  readonly provider: OAuthProvider;
  /** Build authorize URL with PKCE state */
  authorizeUrl(redirectUri: string, state: string): string;
  /** Exchange code for tokens */
  exchangeCode(code: string, redirectUri: string): Promise<OAuthToken | null>;
  /** Refresh an expired token */
  refreshToken(refreshToken: string): Promise<OAuthToken | null>;
  /** Revoke a token */
  revokeToken(accessToken: string): Promise<boolean>;
}
