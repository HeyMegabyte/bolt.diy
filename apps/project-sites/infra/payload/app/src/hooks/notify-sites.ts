import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'
import { createHmac } from 'node:crypto'

/**
 * Webhook-out: on publish/change/delete, notify the projectsites.dev platform so it can
 * revalidate generated sites that embed CMS content (#6, notification half). Fire-and-
 * forget, HMAC-signed (sha256 over the body via SITES_REVALIDATE_SECRET). Dark-safe — a
 * no-op until SITES_REVALIDATE_URL is set, so it ships inert ahead of the receiver.
 */
const notify = (collection: string, slug: string | undefined, event: string, log: (m: string) => void) => {
  const url = process.env.SITES_REVALIDATE_URL
  if (!url || !slug) return
  const payload = JSON.stringify({ collection, slug, event, at: new Date().toISOString() })
  const secret = process.env.SITES_REVALIDATE_SECRET || ''
  const sig = secret ? createHmac('sha256', secret).update(payload).digest('hex') : ''
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-PS-Signature': sig },
    body: payload,
  }).catch((err) => log(`notify-sites failed: ${String(err)}`))
}

export const notifySitesAfterChange =
  (collection: string): CollectionAfterChangeHook =>
  ({ doc, previousDoc, req: { payload } }) => {
    const published = doc?._status === 'published'
    const wasPublished = previousDoc?._status === 'published'
    if (published || wasPublished) {
      notify(collection, doc?.slug, published ? 'published' : 'unpublished', (m) => payload.logger.warn(m))
    }
    return doc
  }

export const notifySitesAfterDelete =
  (collection: string): CollectionAfterDeleteHook =>
  ({ doc, req: { payload } }) => {
    notify(collection, doc?.slug, 'deleted', (m) => payload.logger.warn(m))
    return doc
  }
