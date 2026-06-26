import type { Access, FieldAccess } from 'payload'

/**
 * Role-based + row-level access control helpers for every collection.
 *
 * @remarks
 * Payload runs access functions in two modes: with a `{ id, data, doc }` document
 * context (read/update/delete of a specific row) AND in the "Access Operation" where
 * those args are `undefined` and a returned `Where` query is treated as DENY. Every
 * helper below is written to be safe in both modes — never dereference `data`/`doc`
 * without a guard. See https://payloadcms.com/docs/access-control/overview.
 */

interface RoledUser {
  id: string
  roles?: ('admin' | 'editor')[]
}

const hasRole = (user: unknown, role: 'admin' | 'editor'): boolean => {
  const u = user as RoledUser | null
  return Boolean(u?.roles?.includes(role))
}

/** Anyone — public read. */
export const anyone: Access = () => true

/** Any authenticated user (editor or admin). */
export const authenticated: Access = ({ req: { user } }) => Boolean(user)

/** Admins only. */
export const admins: Access = ({ req: { user } }) => hasRole(user, 'admin')

/** Admins or editors — the content-team gate. */
export const editors: Access = ({ req: { user } }) =>
  hasRole(user, 'admin') || hasRole(user, 'editor')

/**
 * Public sees only published rows; authenticated staff see drafts too.
 * Requires `versions.drafts` on the collection (adds the `_status` field).
 */
export const publishedOrAuth: Access = ({ req: { user } }) => {
  if (user) return true
  return { _status: { equals: 'published' } }
}

/** Admins do anything; a user may act on their own row only. */
export const adminsOrSelf: Access = ({ req: { user } }) => {
  if (!user) return false
  if (hasRole(user, 'admin')) return true
  return { id: { equals: (user as RoledUser).id } }
}

/** Field-level: only admins may write this field (e.g. `roles`). */
export const adminsFieldLevel: FieldAccess = ({ req: { user } }) => hasRole(user, 'admin')
