/**
 * @module services/og_preview
 * @description Pure Open-Graph / Twitter-card meta parser for Pulse Social's
 * link preview. Extracts `{ title, description, image, site_name }` from a page's
 * HTML — used by `POST /api/social/og-preview` (which SSRF-guards + fetches the
 * URL then calls this). Pure (no fetch, no DOM — Workers have no `DOMParser`),
 * so it is fully unit-testable; tolerant regex extraction is sufficient for the
 * handful of meta tags a social link card needs.
 *
 * Precedence: `og:*` wins over `twitter:*` wins over bare `name="description"` /
 * `<title>`. Malformed input degrades to `{}` rather than throwing.
 */

export interface OgData {
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
}

/** Decode the handful of HTML entities that appear in meta content. */
function decodeEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Parse Open-Graph / Twitter-card / standard meta tags from page HTML.
 *
 * @param html - the raw page HTML.
 * @returns the extracted card fields (any may be absent; never throws).
 *
 * @example
 * parseOgTags('<meta property="og:title" content="Hi"><title>x</title>')
 * // → { title: 'Hi' }
 */
export function parseOgTags(html: string): OgData {
  const og: OgData = {};
  if (typeof html !== 'string' || html.length === 0) return og;

  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (!key || !contentMatch) continue;
    const content = decodeEntities(contentMatch[1] ?? '');
    if (!content) continue;

    switch (key) {
      case 'og:title':
        og.title = content;
        break;
      case 'twitter:title':
        og.title ??= content;
        break;
      case 'og:description':
        og.description = content;
        break;
      case 'description':
      case 'twitter:description':
        og.description ??= content;
        break;
      case 'og:image':
      case 'og:image:url':
        og.image = content;
        break;
      case 'twitter:image':
      case 'twitter:image:src':
        og.image ??= content;
        break;
      case 'og:site_name':
        og.site_name = content;
        break;
      default:
        break;
    }
  }

  if (!og.title) {
    const t = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    if (t) {
      const title = decodeEntities(t[1] ?? '');
      if (title) og.title = title;
    }
  }
  return og;
}
