import type { CollectionConfig } from 'payload'
import { publishedOrAuth, editors } from '../access'
import { slugField } from '../fields/slug'
import { defaultEditor } from '../lexical'
import { populatePublishedAt } from '../hooks/publishedAt'
import { computeReadingTime } from '../hooks/readingTime'
import { revalidateAfterChange, revalidateAfterDelete } from '../hooks/revalidate'

/**
 * Blog posts. Publish state is the single `_status` from drafts/versions (the old
 * redundant `status` select is removed). Adds autosave drafts, scheduled publish,
 * live preview, a virtual reading-time, related-posts, and on-demand ISR revalidation.
 */
export const Posts: CollectionConfig = {
  slug: 'posts',
  labels: { singular: 'Blog Post', plural: 'Blog Posts' },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', '_status', 'publishedAt'],
    livePreview: {
      url: ({ data }) => `${process.env.PAYLOAD_PUBLIC_SERVER_URL}/posts/${data?.slug ?? ''}`,
    },
    preview: (doc) =>
      `${process.env.PAYLOAD_PUBLIC_SERVER_URL}/next/preview?path=/posts/${doc?.slug ?? ''}`,
  },
  access: { read: publishedOrAuth, create: editors, update: editors, delete: editors },
  versions: {
    drafts: { autosave: { interval: 800 }, schedulePublish: true },
    maxPerDoc: 25,
  },
  hooks: {
    beforeChange: [populatePublishedAt],
    afterChange: [revalidateAfterChange('posts')],
    afterDelete: [revalidateAfterDelete('posts')],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField('title'),
    { name: 'publishedAt', type: 'date', admin: { position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } } },
    { name: 'author', type: 'relationship', relationTo: 'users', admin: { position: 'sidebar' } },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true, admin: { position: 'sidebar' } },
    { name: 'tags', type: 'relationship', relationTo: 'tags', hasMany: true, admin: { position: 'sidebar' } },
    {
      name: 'readingTime',
      type: 'number',
      virtual: true,
      admin: { position: 'sidebar', readOnly: true, description: 'Estimated minutes (auto)' },
      hooks: { afterRead: [computeReadingTime] },
    },
    { name: 'excerpt', type: 'textarea', maxLength: 300 },
    { name: 'featuredImage', type: 'upload', relationTo: 'media' },
    { name: 'content', type: 'richText', editor: defaultEditor },
    {
      name: 'relatedPosts',
      type: 'relationship',
      relationTo: 'posts',
      hasMany: true,
      filterOptions: ({ id }) => ({ id: { not_equals: id } }),
    },
  ],
}
