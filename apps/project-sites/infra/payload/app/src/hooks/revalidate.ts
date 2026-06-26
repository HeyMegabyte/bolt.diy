import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'
import { revalidatePath } from 'next/cache.js'

/**
 * On-demand ISR: when a published doc changes (or its previously-published version
 * is unpublished), revalidate its front-end path + the collection tag so statically
 * generated pages refresh without a redeploy.
 *
 * @remarks
 * Compares `updatedAt` to skip no-op autosaves, and revalidates the OLD path too when
 * a slug changes so the stale URL is purged. Guarded against the disableRevalidate
 * context flag used by seed scripts. See payloadcms.com Website starter revalidate hook.
 */
const pathFor = (collection: string, slug?: string): string => {
  if (collection === 'pages') return slug === 'home' || !slug ? '/' : `/${slug}`
  return `/${collection}/${slug}`
}

export const revalidateAfterChange =
  (collection: string): CollectionAfterChangeHook =>
  ({ doc, previousDoc, req: { payload, context } }) => {
    if (context?.disableRevalidate) return doc
    try {
      if (doc?._status === 'published') {
        const p = pathFor(collection, doc.slug)
        revalidatePath(p)
        payload.logger.info(`Revalidated ${p}`)
      }
      // Unpublished OR slug changed → purge the old path.
      if (previousDoc?._status === 'published' && previousDoc.slug !== doc?.slug) {
        revalidatePath(pathFor(collection, previousDoc.slug))
      }
    } catch (err) {
      payload.logger.error({ err }, `Revalidate failed for ${collection}`)
    }
    return doc
  }

export const revalidateAfterDelete =
  (collection: string): CollectionAfterDeleteHook =>
  ({ doc, req: { context } }) => {
    if (context?.disableRevalidate) return doc
    try {
      if (doc?.slug) revalidatePath(pathFor(collection, doc.slug))
    } catch {
      /* best-effort */
    }
    return doc
  }
