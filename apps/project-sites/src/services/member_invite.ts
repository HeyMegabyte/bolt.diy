/**
 * @module services/member_invite
 * @description Team member invitation token shapes. Pure — generates, inspects,
 * and validates invitation tokens with zero I/O.
 *
 * @packageDocumentation
 */

/** Roles an invite can grant. */
export type InviteRole = 'admin' | 'editor' | 'viewer';

/** A team-member invitation. */
export interface Invite {
  readonly email: string;
  readonly role: InviteRole;
  readonly orgId: string;
  readonly token: string;
  readonly expiresAt: number;
  readonly acceptedAt: number | null;
}

/** Default TTL for invites: 7 days in milliseconds. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create a new invitation token.
 *
 * @param email - Recipient email address.
 * @param role - Role the invite grants.
 * @param orgId - Organisation this invite scopes to.
 * @param ttlMs - Time-to-live in ms (defaults to {@link INVITE_TTL_MS}).
 * @param nowMs - Epoch ms for "now" (defaults to `Date.now()`); inject for
 *   deterministic tests.
 * @returns A fully-populated {@link Invite}.
 *
 * @example
 * createInvite('a@b.com', 'editor', 'org_abc');
 * // → { email: 'a@b.com', role: 'editor', orgId: 'org_abc', token: '…',
 * //     expiresAt: 1749600000000, acceptedAt: null }
 */
export function createInvite(
  email: string,
  role: InviteRole,
  orgId: string,
  ttlMs: number = INVITE_TTL_MS,
  nowMs: number = Date.now(),
): Invite {
  const token = crypto.randomUUID();
  return {
    acceptedAt: null,
    email,
    expiresAt: nowMs + ttlMs,
    orgId,
    role,
    token,
  };
}

/**
 * Check whether an invite has passed its expiry time.
 *
 * @param invite - The invite to check.
 * @param nowMs - Epoch ms for "now" (defaults to `Date.now()`); inject for
 *   deterministic tests.
 * @returns `true` when `nowMs >= invite.expiresAt`.
 *
 * @example
 * isExpired(invite, invite.expiresAt + 1); // true
 */
export function isExpired(invite: Invite, nowMs: number = Date.now()): boolean {
  return nowMs >= invite.expiresAt;
}

/**
 * Check whether an invite has been accepted.
 *
 * @param invite - The invite to check.
 * @returns `true` when {@link Invite.acceptedAt} is non-null.
 *
 * @example
 * isExpired(invite); // false
 */
export function isAccepted(invite: Invite): boolean {
  return invite.acceptedAt !== null;
}
