import { getClient, SERVER_URL } from '@/lib/payload'

export const dynamic = 'force-dynamic'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** RSS 2.0 feed of published posts. */
export async function GET() {
  const payload = await getClient()
  const res = await payload.find({
    collection: 'posts',
    where: { _status: { equals: 'published' } },
    sort: '-publishedAt',
    limit: 50,
  })
  const items = res.docs
    .map((d) => {
      const p = d as { title?: string; slug?: string; excerpt?: string; publishedAt?: string }
      const link = `${SERVER_URL}/posts/${p.slug ?? ''}`
      return `<item><title>${esc(p.title ?? '')}</title><link>${link}</link><guid>${link}</guid>${
        p.publishedAt ? `<pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>` : ''
      }<description>${esc(p.excerpt ?? '')}</description></item>`
    })
    .join('')
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>ProjectSites Blog</title><link>${SERVER_URL}/posts</link><description>Latest posts</description>${items}</channel></rss>`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } })
}
