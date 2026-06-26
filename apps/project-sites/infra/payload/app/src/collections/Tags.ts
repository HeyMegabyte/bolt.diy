import type { CollectionConfig } from 'payload'
import { anyone, editors } from '../access'
import { slugField } from '../fields/slug'

/** Flat free-tagging taxonomy for media + posts. */
export const Tags: CollectionConfig = {
  slug: 'tags',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'slug'] },
  access: { read: anyone, create: editors, update: editors, delete: editors },
  fields: [{ name: 'name', type: 'text', required: true }, slugField('name')],
}
