import type { Field } from 'payload'

/** Normalize any string into a URL-safe slug. */
export const slugify = (val: string): string =>
  val
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * Reusable slug field: auto-derives from a source field on create when left blank,
 * stays editable, indexed + unique, and pinned to the sidebar.
 *
 * @param sourceField - field name to slugify from (default `'title'`)
 *
 * @example
 * fields: [{ name: 'title', type: 'text' }, slugField('title')]
 */
export const slugField = (sourceField = 'title'): Field => ({
  name: 'slug',
  type: 'text',
  index: true,
  unique: true,
  admin: {
    position: 'sidebar',
    description: 'URL path segment. Auto-generated from the title if left blank.',
  },
  hooks: {
    beforeValidate: [
      ({ value, data }) => {
        if (typeof value === 'string' && value.length > 0) return slugify(value)
        const source = data?.[sourceField]
        if (typeof source === 'string' && source.length > 0) return slugify(source)
        return value
      },
    ],
  },
})
