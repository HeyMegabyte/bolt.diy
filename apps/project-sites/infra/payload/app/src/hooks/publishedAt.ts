import type { CollectionBeforeChangeHook } from 'payload'

/**
 * Stamp `publishedAt` the moment a doc transitions to `_status: 'published'`
 * and the editor hasn't set one. Idempotent — never overwrites an existing value.
 */
export const populatePublishedAt: CollectionBeforeChangeHook = ({ data }) => {
  if (data?._status === 'published' && !data.publishedAt) {
    return { ...data, publishedAt: new Date().toISOString() }
  }
  return data
}
