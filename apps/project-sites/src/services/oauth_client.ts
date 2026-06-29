/**
 * Pure OAuth 2.0 token-request builder and token-response parser.
 *
 * Stateless helpers for constructing token-endpoint requests and parsing
 * standard OAuth 2.0 token responses.  Every function here is a pure
 * function: same inputs → same outputs.  No I/O, no env requirement, no
 * side effects.
 *
 * @remarks
 * The {@link OAUTH_CONFIGS} constant provides pre-populated token URLs
 * and default scopes for the most common IdPs.  Consumers can always
 * supply their own endpoint overrides.
 *
 * @module oauth_client
 */

// ───────────── Types ─────────────

/** The three OAuth 2.0 grant types this client supports. */
export type OAuthGrantType = 'authorization_code' | 'client_credentials' | 'refresh_token';

/** Input to {@link buildTokenRequest}. */
export interface OAuthTokenRequest {
  grantType: OAuthGrantType;
  clientId: string;
  clientSecret: string;

  /** Required for `authorization_code` grants — the redirect URI used in the
   *  authorize step. */
  redirectUri?: string;

  /** Required for `authorization_code` grants — the authorisation code
   *  received from the IdP. */
  code?: string;

  /** Required for `refresh_token` grants — a previously-issued refresh token
   *  that has not yet been revoked. */
  refreshToken?: string;

  /** Space-delimited set of permission scopes.  When omitted the caller's
   *  default scopes (from {@link OAUTH_CONFIGS} or a provider-specific
   *  constant) are used. */
  scopes?: string[];
}

/** Standard OAuth 2.0 token-response fields. */
export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  tokenType: string;
}

// ───────────── Public API ─────────────

/**
 * Builds a token-endpoint HTTP request from typed OAuth parameters.
 *
 * Returns the URL, an `application/x-www-form-urlencoded` body, and the
 * standard headers (Basic auth, content type, and accept).  The caller
 * is responsible for calling `fetch(url, { method: 'POST', headers,
 * body: body.toString() })`.
 *
 * @param opts - The typed OAuth token-request parameters.
 * @returns An object containing the URL, `URLSearchParams` body, and
 *   request headers.
 *
 * @example
 * // Authorization-code grant
 * const req = buildTokenRequest({
 *   grantType: 'authorization_code',
 *   clientId: 'abc',
 *   clientSecret: 'secret',
 *   redirectUri: 'https://app.example/callback',
 *   code: 'auth_code_xyz',
 * });
 * // req.url          → https://oauth2.googleapis.com/token (with
 * //                    OAUTH_CONFIGS lookup; otherwise a caller-supplied URL)
 * // req.body.get('grant_type') → 'authorization_code'
 * // req.body.get('code')       → 'auth_code_xyz'
 * // req.headers['Authorization'] → 'Basic YWJjOnNlY3JldA=='
 *
 * @example
 * // Refresh-token grant
 * const req = buildTokenRequest({
 *   grantType: 'refresh_token',
 *   clientId: 'abc',
 *   clientSecret: 'secret',
 *   refreshToken: 'rtoken_v2_…',
 * });
 * // req.body.get('grant_type')    → 'refresh_token'
 * // req.body.get('refresh_token') → 'rtoken_v2_…'
 */
export function buildTokenRequest(opts: OAuthTokenRequest): {
  url: string;
  body: URLSearchParams;
  headers: Record<string, string>;
} {
  const body = new URLSearchParams();

  body.set('grant_type', opts.grantType);

  // OAuth 2.0 §2.3.1 — client credentials in the request body (accepted by
  // all major IdPs).  Some providers also accept Basic auth; we send both
  // for maximum compatibility.
  body.set('client_id', opts.clientId);
  body.set('client_secret', opts.clientSecret);

  if (opts.scopes && opts.scopes.length > 0) {
    body.set('scope', opts.scopes.join(' '));
  }

  if (opts.grantType === 'authorization_code') {
    if (opts.code) body.set('code', opts.code);
    if (opts.redirectUri) body.set('redirect_uri', opts.redirectUri);
  }

  if (opts.grantType === 'refresh_token' && opts.refreshToken) {
    body.set('refresh_token', opts.refreshToken);
  }

  const credentials = btoa(`${opts.clientId}:${opts.clientSecret}`);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  // Resolve the token URL.  A `redirectUri` can inform URL selection when
  // the caller hasn't provided an explicit URL elsewhere, but for this pure
  // function we return the empty string and let the caller assign one.
  // The URL is intentionally left empty here — the caller passes the actual
  // endpoint.  See OAUTH_CONFIGS for pre-populated defaults.
  return { body, headers, url: '' };
}

/**
 * Parses a standard OAuth 2.0 token-endpoint JSON response body.
 *
 * Extracts `access_token`, `refresh_token` (nullable), `expires_in`, and
 * `token_type` from a successful response.  Returns `null` when the body
 * is missing any of the required fields (`access_token`, `expires_in`,
 * `token_type`) or when the body contains an `error` field.
 *
 * @param body - The raw JSON object returned from the token endpoint.
 * @returns A typed token response, or `null` when parsing fails.
 *
 * @example
 * const result = parseTokenResponse({
 *   access_token: 'ya29.a0Af…',
 *   refresh_token: '1//0g…',
 *   expires_in: 3599,
 *   token_type: 'Bearer',
 * });
 * // → { accessToken: 'ya29.a0Af…', refreshToken: '1//0g…',
 * //     expiresIn: 3599, tokenType: 'Bearer' }
 *
 * @example
 * parseTokenResponse({ error: 'invalid_grant' });
 * // → null
 *
 * @example
 * parseTokenResponse({});
 * // → null
 */
export function parseTokenResponse(body: Record<string, unknown>): TokenResponse | null {
  // Reject error responses immediately
  if (typeof body.error === 'string' || body.error === undefined) {
    // continue
  }

  if (body.error !== undefined) {
    return null;
  }

  const accessToken = body.access_token;
  const expiresIn = body.expires_in;
  const tokenType = body.token_type;

  if (
    typeof accessToken !== 'string' ||
    typeof expiresIn !== 'number' ||
    typeof tokenType !== 'string'
  ) {
    return null;
  }

  const refreshToken =
    typeof body.refresh_token === 'string' ? (body.refresh_token as string) : null;

  return {
    accessToken,
    expiresIn,
    refreshToken,
    tokenType,
  };
}

// ───────────── Provider configs ─────────────

/**
 * Pre-populated OAuth 2.0 token-endpoint URLs and default scopes for the
 * most common providers.
 *
 * Each entry maps a provider slug to the token URL and the default set of
 * scopes that provider uses when no explicit scope is supplied.
 *
 * @example
 * const cfg = OAUTH_CONFIGS.google;
 * const req = buildTokenRequest({
 *   grantType: 'authorization_code',
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   redirectUri: 'https://app.example/oauth/callback',
 *   code: '…',
 *   scopes: cfg.defaultScopes,
 * });
 * req.url = cfg.tokenUrl;
 */
export const OAUTH_CONFIGS: Record<string, { tokenUrl: string; defaultScopes: string[] }> = {
  discord: {
    defaultScopes: ['identify'],
    tokenUrl: 'https://discord.com/api/v10/oauth2/token',
  },
  github: {
    defaultScopes: ['read:user'],
    tokenUrl: 'https://github.com/login/oauth/access_token',
  },
  google: {
    defaultScopes: ['openid', 'email', 'profile'],
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
  linear: {
    defaultScopes: ['read'],
    tokenUrl: 'https://api.linear.app/oauth/token',
  },
  notion: {
    defaultScopes: [],
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
  },
  slack: {
    defaultScopes: ['chat:write', 'users:read'],
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
  },
};
