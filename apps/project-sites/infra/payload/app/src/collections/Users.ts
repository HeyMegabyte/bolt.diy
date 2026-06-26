import type { CollectionConfig } from 'payload'
import { admins, adminsOrSelf, adminsFieldLevel, anyone } from '../access'

/**
 * Staff + authors. `roles` drives every access helper; only admins may grant roles.
 * Auth is hardened with login-attempt lockout. Public can read author profile fields
 * (name/bio/avatar) for byline rendering; mutations stay admin/self.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  labels: { singular: 'User', plural: 'Users' },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'email', 'roles'] },
  auth: {
    maxLoginAttempts: 5,
    lockTime: 600_000, // 10 min
    tokenExpiration: 60 * 60 * 24 * 7, // 7 days
    cookies: { sameSite: 'Lax', secure: true },
  },
  access: {
    read: anyone, // profile fields public for bylines
    create: admins,
    update: adminsOrSelf,
    delete: admins,
    admin: ({ req: { user } }) => Boolean(user),
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      defaultValue: ['editor'],
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
      ],
      access: { update: adminsFieldLevel, create: adminsFieldLevel },
      admin: { position: 'sidebar' },
    },
    { name: 'bio', type: 'textarea' },
    { name: 'avatar', type: 'upload', relationTo: 'media' },
  ],
  versions: false,
}
