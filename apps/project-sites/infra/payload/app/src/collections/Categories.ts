import type { CollectionConfig } from 'payload'
import { anyone, editors } from '../access'
import { slugField } from '../fields/slug'

/**
 * Post taxonomy. Hierarchical via the nested-docs plugin (it injects `parent` +
 * `breadcrumbs`), so "News > Technology" nesting and breadcrumb URLs work out of the box.
 */
export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug'] },
  access: { read: anyone, create: editors, update: editors, delete: editors },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'description', type: 'textarea' },
    slugField('title'),
  ],
}
