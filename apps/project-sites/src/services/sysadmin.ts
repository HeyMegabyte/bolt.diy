/**
 * Server-side super-admin (platform operator) identity check.
 *
 * @remarks
 * The single source of truth for "is this authed user a platform operator?" on
 * the worker. Mirrors the frontend `isSysAdminEmail` guard but is authoritative:
 * a route may NEVER trust a client-supplied role. Admits a user when EITHER the
 * `users.is_super_admin` D1 column is set OR their email is on the operator
 * allowlist (belt-and-suspenders — the column is the durable signal, the email
 * list is the bootstrap before the column is provisioned).
 *
 * @example
 * ```ts
 * if (!(await isSuperAdmin(c.env, userId))) return c.json(forbidden(), 403);
 * ```
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';
import { dbQueryOne } from './db.js';

/** Platform-operator email allowlist (lowercase). Mirrors frontend sys-admin. */
export const SYS_ADMIN_EMAILS: readonly string[] = ['brian@megabyte.space', 'hey@megabyte.space'];

/**
 * Resolve whether `userId` is a platform super-admin.
 *
 * @param env    - Worker env (uses `env.DB`).
 * @param userId - Authenticated user id (from the session, never the client body).
 * @returns true when the user's `is_super_admin` column is set OR their email is
 *   on {@link SYS_ADMIN_EMAILS}. Never throws — a DB failure resolves to false
 *   (fail-closed: deny on doubt).
 */
export async function isSuperAdmin(env: Pick<Env, 'DB'>, userId: string): Promise<boolean> {
  if (!userId) return false;
  const user = await dbQueryOne<{ is_super_admin: number | null; email: string | null }>(
    env.DB,
    'SELECT is_super_admin, email FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  ).catch(() => null);
  if (!user) return false;
  if (user.is_super_admin) return true;
  return !!user.email && SYS_ADMIN_EMAILS.includes(user.email.trim().toLowerCase());
}
