/**
 * Generate sitemap.xml + robots.txt from the tenant's D1 pages table.
 *
 * @remarks
 *  Cached in KV for 5 minutes. Multi-locale aware via `hreflang` alternates.
 *  Production sites get a real `Sitemap:` line in robots; non-prod sites get
 *  `Disallow: /` so unfinished sites never get indexed.
 *
 * @example
 *   const xml = await generateSitemap(env);
 */
import type { Env } from '../env';
import { listPagesForSitemap } from './tenant-db';

const KV_SITEMAP_KEY = 'sitemap:xml';
const KV_ROBOTS_KEY = 'robots:txt';
const TTL = 60 * 5;

export async function generateSitemap(env: Env): Promise<string> {
  const cached = await env.KV.get(KV_SITEMAP_KEY);
  if (cached) return cached;
  const rows = await listPagesForSitemap(env.SITE_DB);
  const origin = `https://${env.PRIMARY_HOSTNAME}`;
  const supported = env.SUPPORTED_LOCALES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

  // Group rows by slug to emit hreflang alternates.
  const bySlug = new Map<string, { locale: string; updated_at: number }[]>();
  for (const r of rows) {
    const slug = r.slug || '/';
    const arr = bySlug.get(slug) ?? [];
    arr.push({ locale: r.locale || env.DEFAULT_LOCALE, updated_at: r.updated_at });
    bySlug.set(slug, arr);
  }

  const urls: string[] = [];
  for (const [slug, variants] of bySlug.entries()) {
    const latest = variants.reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
    const lastmod = new Date(latest.updated_at).toISOString();
    const loc = `${origin}${slug === '/' ? '' : slug.startsWith('/') ? slug : `/${slug}`}`;
    const alternates = supported
      .map((loc2) => `    <xhtml:link rel="alternate" hreflang="${loc2}" href="${origin}/${loc2}${slug === '/' ? '' : slug}"/>`)
      .join('\n');
    urls.push(
      `  <url>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${slug === '/' ? '1.0' : '0.7'}</priority>\n${alternates}\n  </url>`,
    );
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`;
  await env.KV.put(KV_SITEMAP_KEY, xml, { expirationTtl: TTL });
  return xml;
}

export async function generateRobots(env: Env): Promise<string> {
  const cached = await env.KV.get(KV_ROBOTS_KEY);
  if (cached) return cached;
  const origin = `https://${env.PRIMARY_HOSTNAME}`;
  const lines =
    env.ENVIRONMENT === 'production'
      ? [
          'User-agent: *',
          'Allow: /',
          'Disallow: /api/',
          'Disallow: /_/',
          '',
          `Sitemap: ${origin}/sitemap.xml`,
        ]
      : ['User-agent: *', 'Disallow: /'];
  const text = lines.join('\n') + '\n';
  await env.KV.put(KV_ROBOTS_KEY, text, { expirationTtl: TTL });
  return text;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
