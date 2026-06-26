import type { CollectionConfig } from 'payload'

export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Blog Post', plural: 'Blog Posts' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'status', 'publishedAt'],
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
    {
      name: 'status',
      type: 'select',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
      defaultValue: 'draft',
      admin: { position: 'sidebar' },
    },
    { name: 'publishedAt', type: 'date', admin: { position: 'sidebar' } },
    { name: 'author', type: 'relationship', relationTo: 'users', admin: { position: 'sidebar' } },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
    { name: 'excerpt', type: 'textarea' },
    { name: 'featuredImage', type: 'upload', relationTo: 'media' },
    { name: 'content', type: 'richText' },
  ],
}
