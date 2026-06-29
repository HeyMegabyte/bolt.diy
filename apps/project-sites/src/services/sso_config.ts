/**
 * @module services/sso_config
 *
 * SSO/OIDC provider configuration shapes for Better Auth enterprise.
 * Pure types + pure functions — no I/O, no side-effects, no runtime deps.
 *
 * Provides typed provider names, config interface, factory, validator,
 * and per-provider default scope sets.
 *
 * @packageDocumentation
 */

/**
 * Supported SSO/OIDC identity providers.
 *
 * `custom_oidc` represents any generic OpenID Connect provider not in the
 * well-known list (Keycloak, Auth0, FusionAuth, etc.).
 */
export type SsoProvider = 'google' | 'github' | 'microsoft' | 'okta' | 'custom_oidc';

/**
 * SSO/OIDC client configuration.
 *
 * Every field is required — omitting any makes the config invalid per
 * {@link validateSsoConfig}.
 */
export interface SsoConfig {
  /** OAuth 2.0 client ID (from the provider's app registration). */
  clientId: string;
  /** OpenID Connect issuer URL. */
  issuer: string;
  /** Provider key from {@link SsoProvider}. */
  provider: SsoProvider;
  /** Authorization callback URL (where the provider redirects after login). */
  redirectUri: string;
  /** OAuth scopes requested during authorization. */
  scopes: string[];
}

/**
 * Build an {@link SsoConfig} with provider-appropriate default scopes.
 *
 * Scopes are populated from {@link DEFAULT_SCOPES} based on the provider.
 *
 * @param provider - The identity provider.
 * @param clientId - OAuth 2.0 client ID.
 * @param issuer - OIDC issuer URL.
 * @param redirectUri - Authorization callback URL.
 * @returns A fully-formed {@link SsoConfig}.
 *
 * @example
 * const cfg = buildSsoConfig('google', 'abc123.apps.googleusercontent.com',
 *   'https://accounts.google.com', 'https://myapp.com/api/auth/callback/google');
 * // cfg.scopes === ['openid', 'profile', 'email', '...userinfo.profile']
 */
export function buildSsoConfig(
  provider: SsoProvider,
  clientId: string,
  issuer: string,
  redirectUri: string,
): SsoConfig {
  return {
    clientId,
    issuer,
    provider,
    redirectUri,
    scopes: [...DEFAULT_SCOPES[provider]],
  };
}

/**
 * Validate an {@link SsoConfig} for common configuration errors.
 *
 * Checks:
 * - Every required field is non-empty
 * - `clientId` has no whitespace
 * - `redirectUri` and `issuer` look like valid absolute URLs
 * - `scopes` is non-empty and every entry is a non-blank string
 *
 * @param config - The config to validate.
 * @returns `{ valid, errors }` — `valid` is `true` when `errors` is empty.
 *
 * @example
 * const { valid, errors } = validateSsoConfig(myConfig);
 * if (!valid) console.error(errors);
 */
export function validateSsoConfig(config: SsoConfig): { errors: string[]; valid: boolean } {
  const errors: string[] = [];

  if (!SSO_PROVIDER_SET.has(config.provider)) {
    errors.push(`provider must be one of: ${SSO_PROVIDERS.join(', ')}`);
  }

  if (!config.clientId) {
    errors.push('clientId is required');
  } else if (/\s/.test(config.clientId)) {
    errors.push('clientId must not contain whitespace');
  }

  if (!config.issuer) {
    errors.push('issuer is required');
  } else if (!URL_CANONICAL.test(config.issuer)) {
    errors.push('issuer must be a valid absolute URL');
  }

  if (!config.redirectUri) {
    errors.push('redirectUri is required');
  } else if (!URL_CANONICAL.test(config.redirectUri)) {
    errors.push('redirectUri must be a valid absolute URL');
  }

  if (!config.scopes || config.scopes.length === 0) {
    errors.push('scopes must be non-empty');
  } else if (config.scopes.some((s) => typeof s !== 'string' || s.trim().length === 0)) {
    errors.push('each scope must be a non-empty string');
  }

  return { errors, valid: errors.length === 0 };
}

/**
 * Loose check for absolute http/https URLs (not a full RFC 3986 parser).
 */
const URL_CANONICAL = /^https?:\/\/.+/i;

/**
 * All supported {@link SsoProvider} values as a readonly tuple.
 *
 * Useful for enumerating providers in admin UIs, feature flags, or
 * allowlist checks.
 */
export const SSO_PROVIDERS: readonly SsoProvider[] = [
  'custom_oidc',
  'github',
  'google',
  'microsoft',
  'okta',
] as const;

/** Set representation of {@link SSO_PROVIDERS} for O(1) membership checks. */
const SSO_PROVIDER_SET: ReadonlySet<string> = new Set<string>(SSO_PROVIDERS);

/**
 * Per-provider default OAuth scopes.
 *
 * Every well-known provider gets `openid`, `profile`, and `email`. Providers
 * that offer additional useful scopes (Google profile read, Microsoft/Okta
 * refresh tokens) include those too.
 *
 * `custom_oidc` omits provider-specific extras — the caller should pass
 * explicit scopes to {@link buildSsoConfig} if more are needed.
 */
export const DEFAULT_SCOPES: Record<SsoProvider, readonly string[]> = {
  custom_oidc: ['openid', 'profile', 'email'],
  github: ['openid', 'profile', 'email'],
  google: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/userinfo.profile'],
  microsoft: ['openid', 'profile', 'email', 'offline_access'],
  okta: ['openid', 'profile', 'email', 'offline_access'],
};
