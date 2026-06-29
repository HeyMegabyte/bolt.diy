/**
 * @module services/api_version
 *
 * @description
 * Pure API version helpers for the project-sites Worker. These functions parse
 * version strings, determine deprecation relative to the current version, and
 * produce `X-API-Version` response headers.
 *
 * All functions are pure — no I/O, no clock, no mutable state.
 *
 * @example
 * ```ts
 * import { parseVersion, isDeprecated, versionHeader, API_VERSIONS } from './api_version.js';
 *
 * const v = parseVersion('v2');
 * // v → { label: 'v2', major: 2 }
 *
 * isDeprecated('v1', 'v2');
 * // → true  (v1 is deprecated when current is v2)
 *
 * versionHeader('v2');
 * // → 'v2'
 * ```
 */

/** A parsed API version. */
export interface ParsedVersion {
  /** Canonical label (e.g. `'v2'`). */
  readonly label: string;
  /** Numeric major version (e.g. `2` from `'v2'`). */
  readonly major: number;
}

/**
 * The authoritative list of supported API versions, ordered newest-first.
 *
 * Mutations to this array MUST be additive — old versions are never removed
 * until every consumer has migrated (see {@link isDeprecated} for signalling).
 */
export const API_VERSIONS: readonly string[] = ['v1', 'v2'] as const;

const VERSION_REGEX = /^v(\d+)$/;

/**
 * Parse a version string into its numeric major and canonical label.
 *
 * @param v - A version string like `'v1'` or `'v2'`.
 * @returns A {@link ParsedVersion} when the string matches the `v{N}` pattern.
 * @throws {RangeError} When the string is not a valid `v{N}` form.
 *
 * @example
 * ```ts
 * parseVersion('v2');
 * // → { major: 2, label: 'v2' }
 *
 * parseVersion('v10');
 * // → { major: 10, label: 'v10' }
 * ```
 */
export function parseVersion(v: string): ParsedVersion {
  const m = VERSION_REGEX.exec(v);
  if (!m) {
    throw new RangeError(`Invalid API version: "${v}". Expected format "v{N}" (e.g. "v1", "v2").`);
  }
  const major = Number(m[1]);
  if (!Number.isInteger(major) || major < 1) {
    throw new RangeError(`Invalid API version: "${v}". Major must be a positive integer.`);
  }
  return { label: v, major };
}

/**
 * Determine whether a version is deprecated relative to the current version.
 *
 * A version is deprecated when it is not the newest known version AND it is
 * one of the registered {@link API_VERSIONS}. Unknown/unrecognised versions
 * are never reported as deprecated (they may be future versions).
 *
 * @param version - The version to check (e.g. `'v1'`).
 * @param current  - The current/latest version (e.g. `'v2'`).
 * @returns `true` when `version` is lower than `current` and is a recognised
 *   API version.
 *
 * @example
 * ```ts
 * isDeprecated('v1', 'v2');
 * // → true
 *
 * isDeprecated('v2', 'v2');
 * // → false
 *
 * isDeprecated('v3', 'v2');
 * // → false (v3 is not a registered version yet)
 * ```
 */
export function isDeprecated(version: string, current: string): boolean {
  if (!API_VERSIONS.includes(version)) return false;
  try {
    const parsed = parseVersion(version);
    const parsedCurrent = parseVersion(current);
    return parsed.major < parsedCurrent.major;
  } catch {
    return false;
  }
}

/**
 * Format a version string for use in an `X-API-Version` response header.
 *
 * @param version - A version string like `'v1'` or `'v2'`.
 * @returns The canonical header value (the version label unchanged).
 *
 * @example
 * ```ts
 * versionHeader('v2');
 * // → 'v2'
 * ```
 */
export function versionHeader(version: string): string {
  return version;
}
