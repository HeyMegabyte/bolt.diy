import type { CollectionConfig } from 'payload'
import { anyone, editors } from '../access'

/**
 * R2-backed media library. Generates responsive sizes (thumbnail → og) on upload via
 * sharp, supports a focal point for smart cropping, and requires alt text for a11y.
 * Read is public; mutations are editor+.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  access: { read: anyone, create: editors, update: editors, delete: editors },
  admin: { useAsTitle: 'alt' },
  upload: {
    focalPoint: true,
    mimeTypes: ['image/*', 'application/pdf', 'video/mp4'],
    formatOptions: { format: 'webp', options: { quality: 82 } },
    imageSizes: [
      { name: 'thumbnail', width: 300, height: 300, position: 'centre' },
      { name: 'card', width: 768, height: 512, position: 'centre' },
      { name: 'feature', width: 1280, height: 720, position: 'centre' },
      { name: 'og', width: 1200, height: 630, position: 'centre' },
    ],
  },
  fields: [
    { name: 'alt', type: 'text', required: true, admin: { description: 'Accessibility description' } },
    { name: 'caption', type: 'text' },
    { name: 'credit', type: 'text', admin: { description: 'Attribution / source' } },
    { name: 'tags', type: 'relationship', relationTo: 'tags', hasMany: true },
  ],
}
