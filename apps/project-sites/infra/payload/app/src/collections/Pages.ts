import type { CollectionConfig } from 'payload'

export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'updatedAt'],
  },
  // Public sees only published; authenticated admins see drafts too.
  access: { read: ({ req: { user } }) => (user ? true : { _status: { equals: 'published' } }) },
  versions: { drafts: { autosave: false }, maxPerDoc: 20 },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: { position: 'sidebar', description: 'URL-friendly identifier' },
    },
    { name: 'content', type: 'richText' },
  ],
}
