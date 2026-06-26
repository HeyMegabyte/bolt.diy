import type { Endpoint } from 'payload'

/**
 * GET /api/blog.json — public, clean syndication feed of published posts for generated
 * projectsites.dev sites to consume (the consumption contract for the CMS-blog feature).
 * Stable, flat shape — never leaks Payload's verbose internal doc structure. Cached at
 * the edge for 5 min.
 *
 * @remarks Public read (published only); no auth. `?limit=` caps at 100.
 */
export const blogFeedEndpoint: Endpoint = {
  path: '/blog.json',
  method: 'get',
  handler: async (req) => {
    const url = new URL(req.url ?? 'http://localhost')
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100)
    const base = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'https://cms.projectsites.dev'

    const res = await req.payload.find({
      collection: 'posts',
      where: { _status: { equals: 'published' } },
      sort: '-publishedAt',
      depth: 1,
      limit,
      overrideAccess: false,
    })

    const posts = res.docs.map((d) => {
      const p = d as {
        title?: string
        slug?: string
        excerpt?: string
        publishedAt?: string
        author?: { name?: string }
        categories?: { title?: string }[]
        featuredImage?: { url?: string; sizes?: { card?: { url?: string } } }
      }
      return {
        title: p.title ?? '',
        slug: p.slug ?? '',
        url: `${base}/posts/${p.slug ?? ''}`,
        excerpt: p.excerpt ?? '',
        publishedAt: p.publishedAt ?? null,
        author: p.author?.name ?? null,
        categories: Array.isArray(p.categories) ? p.categories.map((c) => c?.title).filter(Boolean) : [],
        image: p.featuredImage?.sizes?.card?.url ?? p.featuredImage?.url ?? null,
      }
    })

    return Response.json(
      { count: posts.length, posts },
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300', 'Access-Control-Allow-Origin': '*' } },
    )
  },
}
