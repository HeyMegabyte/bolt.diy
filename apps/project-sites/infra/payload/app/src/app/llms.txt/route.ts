import { getClient, SERVER_URL } from '@/lib/payload'

export const dynamic = 'force-dynamic'

/**
 * /llms.txt — the AI-discovery manifest (llmstxt.org). Gives LLM crawlers a clean,
 * link-rich index of published content so agents can find + cite the blog and pages.
 */
export async function GET() {
  const payload = await getClient()
  const [posts, pages] = await Promise.all([
    payload.find({
      collection: 'posts',
      where: { _status: { equals: 'published' } },
      sort: '-publishedAt',
      limit: 200,
      depth: 0,
    }),
    payload.find({
      collection: 'pages',
      where: { _status: { equals: 'published' } },
      limit: 200,
      depth: 0,
    }),
  ])

  const line = (d: unknown, prefix: string) => {
    const x = d as { title?: string; slug?: string; excerpt?: string }
    const url = prefix === 'posts' ? `${SERVER_URL}/posts/${x.slug}` : `${SERVER_URL}/${x.slug}`
    return `- [${x.title ?? x.slug}](${url})${x.excerpt ? `: ${x.excerpt}` : ''}`
  }

  const body = [
    '# ProjectSites',
    '',
    '> AI-built websites, delivered. This CMS powers the projectsites.dev blog + marketing pages.',
    '',
    '## Blog posts',
    ...(posts.docs.length ? posts.docs.map((d) => line(d, 'posts')) : ['- (none published yet)']),
    '',
    '## Pages',
    ...(pages.docs.length ? pages.docs.map((d) => line(d, 'pages')) : ['- (none published yet)']),
    '',
    '## Feeds',
    `- [Blog JSON](${SERVER_URL}/api/blog.json)`,
    `- [RSS](${SERVER_URL}/feed.xml)`,
    `- [Sitemap](${SERVER_URL}/sitemap.xml)`,
    '',
  ].join('\n')

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
  })
}
