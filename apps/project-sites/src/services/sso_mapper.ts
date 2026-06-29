/**
 * @module services/sso_mapper
 *
 * @description Pure OIDC claim mapper. Transforms raw OIDC userinfo/id-token
 * claims into a canonical {@link MappedProfile} — mail, name, avatar, stable
 * provider-level user ID — keyed by provider name. Supports merging multiple
 * provider profiles into one unified record for federated identity reconciliation.
 *
 * No I/O, no side-effects, no runtime deps. Every export is a pure function
 * or a frozen constant.
 *
 * Each provider maps the same semantic fields through different claim keys.
 * {@link PROVIDER_FIELDS} encodes the canonical key per field per provider;
 * `mapOidcClaims` reads those keys and falls through to the first non-null
 * value, so a missing `picture` on Google does not break the whole mapping.
 *
 * @packageDocumentation
 */

/**
 * Raw OIDC claims from a provider's userinfo endpoint or ID token.
 *
 * Keys and value types vary across providers — {@link mapOidcClaims}
 * reads from this object through {@link PROVIDER_FIELDS}.
 */
export type OidcProfile = Record<string, unknown>;

/**
 * Canonical profile after mapping OIDC claims.
 *
 * - `email` — primary email (may be null if the provider did not return one).
 * - `name` — display name (full name, username, or null).
 * - `avatar` — URL to the profile picture (may be null).
 * - `providerId` — stable, provider-scoped user identifier (never null).
 */
export interface MappedProfile {
  email: string | null;
  name: string | null;
  avatar: string | null;
  providerId: string;
}

/**
 * Field mapping for one provider: arrays of claim keys to try for `[email,
 * name, avatar, providerId]` in fallback priority order.
 *
 * Each inner array lists claim keys to try in sequence — the first non-null
 * string value wins, so `login` after `name` means "full name preferred,
 * username fallback". A single-element array works the same as a bare key.
 *
 * @example
 * // Google stores all fields under standard OIDC keys
 * PROVIDER_FIELDS.google
 * // → [['email'], ['name'], ['picture'], ['sub']]
 *
 * // GitHub may use `login` when `name` is absent
 * PROVIDER_FIELDS.github
 * // → [['email'], ['name', 'login'], ['avatar_url'], ['id', 'node_id']]
 *
 * @remarks Providers not listed in this record are unknown — {@link mapOidcClaims}
 * still attempts to extract from standard OIDC claims (`sub`, `email`, `name`,
 * `picture`) but logs nothing and returns what it can.
 */
export const PROVIDER_FIELDS: Readonly<
  Record<
    string,
    readonly [readonly string[], readonly string[], readonly string[], readonly string[]]
  >
> = {
  custom_oidc: [['email'], ['name'], ['picture'], ['sub']],
  github: [['email'], ['name', 'login'], ['avatar_url'], ['id', 'node_id']],
  google: [['email'], ['name'], ['picture'], ['sub']],
  microsoft: [['email'], ['name'], ['picture'], ['sub']],
  okta: [['email'], ['name'], ['picture'], ['sub']],
} as const;

/**
 * Extract a string value from a profile by trying keys in order.
 *
 * Returns the first string found (non-null, non-whitespace string) from the
 * given keys. If a key holds a number (e.g. GitHub's `id`), it is
 * coerced to a string. Returns `null` when no key yields a usable value.
 *
 * @param profile - Raw OIDC claims record.
 * @param keys - Claim keys to try, in priority order.
 * @returns The first usable string value, or `null`.
 *
 * @internal
 *
 * @example
 * const p = { email: 'a@b.com', name: 'Alice' };
 * stringValue(p, ['email', 'name']);   // → 'a@b.com'
 * stringValue(p, ['missing', 'name']); // → 'Alice'
 * stringValue(p, ['missing']);         // → null
 */
function stringValue(profile: OidcProfile, keys: readonly string[]): string | null {
  for (const key of keys) {
    const val = profile[key];
    if (typeof val === 'string' && val.trim().length > 0) return val;
    if (typeof val === 'number' && !Number.isNaN(val)) return String(val);
    if (typeof val === 'bigint') return String(val);
  }
  return null;
}

/**
 * Map raw OIDC claims from a provider to a canonical {@link MappedProfile}.
 *
 * Uses {@link PROVIDER_FIELDS} to determine which claim keys to read for
 * `email`, `name`, `avatar`, and `providerId`. Falls back to standard OIDC
 * claims (`sub`, `email`, `name`, `picture`) when the provider is not listed
 * in {@link PROVIDER_FIELDS}.
 *
 * @param profile - Raw OIDC userinfo or id-token claims.
 * @param provider - Provider name (e.g. `'google'`, `'github'`, `'custom_oidc'`).
 * @returns A canonical profile. `providerId` is always a string; other
 *   fields may be `null` if the provider did not return a value.
 *
 * @example
 * const claims = {
 *   sub: '12345',
 *   email: 'alice@gmail.com',
 *   name: 'Alice Johnson',
 *   picture: 'https://.../photo.jpg',
 * };
 * mapOidcClaims(claims, 'google');
 * // → { email: 'alice@gmail.com', name: 'Alice Johnson', avatar: 'https://.../photo.jpg', providerId: '12345' }
 *
 * @example
 * // GitHub uses different claim keys; `login` is the fallback for `name`
 * mapOidcClaims({ id: 42, login: 'alice', avatar_url: 'https://...' }, 'github');
 * // → { email: null, name: 'alice', avatar: 'https://...', providerId: '42' }
 */
export function mapOidcClaims(profile: OidcProfile, provider: string): MappedProfile {
  const fields =
    PROVIDER_FIELDS[provider] ?? ([['email'], ['name'], ['picture'], ['sub']] as const);

  const email = stringValue(profile, fields[0]);
  const name = stringValue(profile, fields[1]);
  const avatar = stringValue(profile, fields[2]);

  // providerId: primary key, then fallback to "sub" for unknown providers
  const providerId = stringValue(profile, fields[3]) ?? stringValue(profile, ['sub']) ?? '';

  return { avatar, email, name, providerId };
}

/**
 * Merge multiple {@link MappedProfile}s into a single unified profile.
 *
 * When multiple providers return profiles for the same user, this function
 * reconciles them: the first non-null `email`, `name`, and `avatar` win.
 * `providerId` comes from the first entry only (the "primary" link).
 *
 * Returns `null` when `profiles` is empty.
 *
 * @param profiles - Array of mapped profiles to merge.
 * @returns A unified profile, or `null` for an empty array.
 *
 * @example
 * const google = { email: 'a@gmail.com', name: 'Alice G', avatar: 'https://g/...', providerId: 'g1' };
 * const github = { email: null, name: 'alice_dev', avatar: null, providerId: 'gh1' };
 * mergeProfiles([google, github]);
 * // → { email: 'a@gmail.com', name: 'Alice G', avatar: 'https://g/...', providerId: 'g1' }
 *
 * @example
 * mergeProfiles([]);
 * // → null
 */
export function mergeProfiles(profiles: MappedProfile[]): MappedProfile | null {
  if (profiles.length === 0) return null;

  const [first, ...rest] = profiles;

  let email = first.email;
  let name = first.name;
  let avatar = first.avatar;

  for (const p of rest) {
    if (email === null && p.email !== null) email = p.email;
    if (name === null && p.name !== null) name = p.name;
    if (avatar === null && p.avatar !== null) avatar = p.avatar;
  }

  return {
    avatar,
    email,
    name,
    providerId: first.providerId,
  };
}
