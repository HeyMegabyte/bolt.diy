import type { MetadataRoute } from 'next'
import { getClient, SERVER_URL } from '@/lib/payload'

export const revalidate = 3600

/** Dynamic sitemap built from every published Page + Post. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const payload = await getClient()
  const [pages, posts] = await Promise.all([
    payload.find({
      collection: 'pages',
      where: { _status: { equals: 'published' } },
      limit: 1000,
      select: { slug: true, updatedAt: true },
    }),
    payload.find({
      collection: 'posts',
      where: { _status: { equals: 'published' } },
      limit: 1000,
      select: { slug: true, updatedAt: true },
    }),
  ])
  const entries: MetadataRoute.Sitemap = [{ url: SERVER_URL, changeFrequency: 'weekly', priority: 1 }]
  for (const d of pages.docs) {
    const p = d as { slug?: string; updatedAt?: string }
    if (!p.slug || p.slug === 'home') continue
    entries.push({ url: `${SERVER_URL}/${p.slug}`, lastModified: p.updatedAt })
  }
  for (const d of posts.docs) {
    const p = d as { slug?: string; updatedAt?: string }
    if (!p.slug) continue
    entries.push({ url: `${SERVER_URL}/posts/${p.slug}`, lastModified: p.updatedAt, changeFrequency: 'monthly' })
  }
  return entries
}
