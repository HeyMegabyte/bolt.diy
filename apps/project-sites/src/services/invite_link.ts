/**
 * @module invite_link
 * @description Pure-functions service for creating, validating, and consuming
 * invite links. No I/O — works entirely in memory on the InviteLink shape.
 *
 * An invite link is a shareable URL token that grants a specific role within
 * an organisation for a limited time / number of uses.
 *
 * | Field       | Type     | Description                                |
 * | ----------- | -------- | ------------------------------------------ |
 * | token       | string   | Crypto-random 128-bit hex token            |
 * | orgId       | string   | Target organisation identifier             |
 * | role        | string   | Role granted on use (e.g. "admin")         |
 * | expiresAt   | number   | Unix-ms deadline; link dead after this     |
 * | maxUses     | number   | Cap on total uses (0 = unlimited)          |
 * | useCount    | number   | How many times the link has been used      |
 *
 * @example
 * ```ts
 * import { createInviteLink, isValid, useLink, DEFAULT_TTL } from '../services/invite_link.js';
 *
 * const link = createInviteLink('org_abc', 'admin', 5, DEFAULT_TTL, Date.now());
 * // → { token: 'a1b2…', orgId: 'org_abc', role: 'admin', expiresAt: …, maxUses: 5, useCount: 0 }
 *
 * isValid(link, Date.now());
 * // → true (fresh link)
 *
 * const used = useLink(link);
 * // → { …, useCount: 1 }
 * ```
 *
 * @packageDocumentation
 */

/**
 * Represents a shareable invite link with usage tracking.
 */
export interface InviteLink {
  /** Cryptographically-random hex token (32 hex chars = 128 bits). */
  token: string;
  /** Identifier of the organisation the link grants access to. */
  orgId: string;
  /** Role assigned when the link is used (e.g. "admin", "member"). */
  role: string;
  /** Expiration timestamp as Unix milliseconds. */
  expiresAt: number;
  /** Maximum number of times the link may be used (0 = unlimited). */
  maxUses: number;
  /** Current number of times the link has been consumed. */
  useCount: number;
}

/** Default time-to-live for new invite links: 72 hours in milliseconds. */
export const DEFAULT_TTL = 72 * 3600 * 1000;

/**
 * Creates a new invite link with the given parameters.
 *
 * @param orgId  - Target organisation identifier.
 * @param role   - Role granted on use.
 * @param maxUses - Maximum number of uses (default 0 = unlimited).
 * @param ttlMs  - Time-to-live in milliseconds (default {@link DEFAULT_TTL}).
 * @param nowMs  - Current time in milliseconds (default `Date.now()`), provided
 *                 for testability.
 * @returns A new {@link InviteLink} with a fresh token and zero uses.
 *
 * @example
 * ```ts
 * const link = createInviteLink('org_abc', 'admin');
 * // token is a fresh 32-hex-char string, expiresAt = now + 72h
 * ```
 */
export function createInviteLink(
  orgId: string,
  role: string,
  maxUses = 0,
  ttlMs = DEFAULT_TTL,
  nowMs = Date.now(),
): InviteLink {
  const token = crypto.randomUUID().replace(/-/g, '');
  return {
    expiresAt: nowMs + ttlMs,
    maxUses,
    orgId,
    role,
    token,
    useCount: 0,
  };
}

/**
 * Checks whether an invite link is still valid (not expired and under its use
 * cap).
 *
 * @param link  - The invite link to check.
 * @param nowMs - Current time in milliseconds (default `Date.now()`), provided
 *                for testability.
 * @returns `true` if the link has not expired AND (has remaining uses OR
 *          maxUses is 0 for unlimited).
 *
 * @example
 * ```ts
 * const link = createInviteLink('org_abc', 'admin', 1);
 * isValid(link); // → true (fresh)
 * isValid(link, link.expiresAt + 1); // → false (expired)
 * ```
 */
export function isValid(link: InviteLink, nowMs = Date.now()): boolean {
  if (link.expiresAt <= nowMs) {
    return false;
  }
  if (link.maxUses > 0 && link.useCount >= link.maxUses) {
    return false;
  }
  return true;
}

/**
 * Consumes one use of the invite link by incrementing its `useCount`.
 *
 * **This function is** pure **— it returns a new {@link InviteLink} with the
 * incremented count rather than mutating the original.**
 *
 * @param link - The invite link to consume.
 * @returns A new {@link InviteLink} with `useCount` incremented by 1.
 *
 * @example
 * ```ts
 * const link = createInviteLink('org_abc', 'admin', 3);
 * const used = useLink(link);
 * used.useCount // → 1
 * link.useCount // → 0 (original unchanged)
 * ```
 */
export function useLink(link: InviteLink): InviteLink {
  return {
    ...link,
    useCount: link.useCount + 1,
  };
}
