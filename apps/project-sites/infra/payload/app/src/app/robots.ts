import type { MetadataRoute } from 'next'
import { SERVER_URL } from '@/lib/payload'

/** robots.txt — allow crawl of the public frontend, block the admin + API. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api'] },
    sitemap: `${SERVER_URL}/sitemap.xml`,
  }
}
