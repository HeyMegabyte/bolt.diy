import type { CollectionConfig } from 'payload'
import { publishedOrAuth, editors } from '../access'
import { slugField } from '../fields/slug'
import { layoutBlocks } from '../blocks'
import { populatePublishedAt } from '../hooks/publishedAt'
import { revalidateAfterChange, revalidateAfterDelete } from '../hooks/revalidate'

/**
 * Marketing/content pages built from composable layout blocks (page builder) rather
 * than a single rich-text body. Drafts + live preview + on-demand ISR. `slug: 'home'`
 * renders at `/`.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
    livePreview: {
      url: ({ data }) => {
        const s = data?.slug
        return `${process.env.PAYLOAD_PUBLIC_SERVER_URL}/${!s || s === 'home' ? '' : s}`
      },
    },
    preview: (doc) => {
      const s = doc?.slug
      const p = !s || s === 'home' ? '/' : `/${s}`
      return `${process.env.PAYLOAD_PUBLIC_SERVER_URL}/next/preview?path=${p}`
    },
  },
  access: { read: publishedOrAuth, create: editors, update: editors, delete: editors },
  versions: { drafts: { autosave: { interval: 800 }, schedulePublish: true }, maxPerDoc: 25 },
  hooks: {
    beforeChange: [populatePublishedAt],
    afterChange: [revalidateAfterChange('pages')],
    afterDelete: [revalidateAfterDelete('pages')],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    slugField('title'),
    { name: 'publishedAt', type: 'date', admin: { position: 'sidebar' } },
    { name: 'layout', type: 'blocks', blocks: layoutBlocks, minRows: 1 },
  ],
}
