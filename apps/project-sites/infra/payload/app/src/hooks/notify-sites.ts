import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

/**
 * Notify the main projectsites worker when published Pages/Posts change so its
 * site-serving edge can refresh affected customer content (imports existed in
 * Pages.ts/Posts.ts but the file was never committed — created 2026-08-20 to
 * unblock the payload container build; the payload deploy had been failing on
 * the missing module).
 *
 * Best-effort: the notification is fire-and-forget; a missing callback URL or a
 * failed POST must never block the CMS write.
 */
const NOTIFY_URL = process.env.PAYLOAD_NOTIFY_URL ?? 'https://projectsites.dev/api/cms/hooks/content-changed'

async function notify(collection: string, slug?: string): Promise<void> {
  if (!NOTIFY_URL) return
  try {
    await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection, slug }),
    })
  } catch {
    /* best-effort — never block the CMS write */
  }
}

export const notifySitesAfterChange =
  (collection: string): CollectionAfterChangeHook =>
  async ({ doc }) => {
    if (doc?._status === 'published') {
      await notify(collection, doc?.slug)
    }
    return doc
  }

export const notifySitesAfterDelete =
  (collection: string): CollectionAfterDeleteHook =>
  async ({ doc }) => {
    await notify(collection, doc?.slug)
    return doc
  }
