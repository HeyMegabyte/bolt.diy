/**
 * @module services/rss_import
 * @description Pure RSS/Atom feed parser for Pulse Social's "import from RSS"
 * feature. Extracts `{ title, url }` items from a feed XML string — used by the
 * `POST /api/social/import-rss` preview route (which fetches the feed + calls
 * this). Pure (no fetch, no DOM) so it is fully unit-testable; Workers have no
 * `DOMParser`, so this uses tolerant regex extraction sufficient for the
 * title+link a social-post draft needs.
 *
 * Handles both RSS (`<item><title><link>URL</link>`) and Atom
 * (`<entry><title><link href="URL">`). Malformed input degrades to `[]` rather
 * than throwing, so a bad feed never crashes the import route.
 */

export interface RssItem {
  title: string;
  url: string;
}

/** Decode the handful of XML entities + strip CDATA wrappers from a text node. */
function decodeXmlText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** First `<title>…</title>` text within a block (CDATA-aware), or ''. */
function extractTitle(block: string): string {
  const m = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeXmlText(m[1] ?? '') : '';
}

/**
 * The item's link: Atom `<link href="…">` (prefer rel="alternate"/no-rel) wins,
 * else RSS `<link>…</link>` text. Returns '' when neither is present/valid.
 */
function extractLink(block: string): string {
  // Atom: <link rel="alternate" href="..."/> or <link href="..."/>
  const hrefs = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)];
  for (const tag of hrefs) {
    const attrs = tag[1] ?? '';
    if (/rel\s*=\s*["']?(self|edit|replies)["']?/i.test(attrs)) continue; // skip non-content rels
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i);
    if (href) return decodeXmlText(href[1] ?? '');
  }
  // RSS: <link>https://…</link>
  const rss = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  if (rss) {
    const url = decodeXmlText(rss[1] ?? '');
    if (url) return url;
  }
  return '';
}

/**
 * Parse an RSS or Atom feed XML string into `{ title, url }` items (newest-first
 * as the feed orders them), capped at `limit`. An item is kept only when BOTH a
 * title and a URL are found.
 *
 * @param xml - the raw feed body.
 * @param limit - max items to return (default 10).
 * @returns extracted items (possibly empty — never throws on malformed input).
 *
 * @example
 * parseRssFeed('<rss><channel><item><title>Hi</title><link>https://x.com/a</link></item></channel></rss>')
 * // → [{ title: 'Hi', url: 'https://x.com/a' }]
 */
export function parseRssFeed(xml: string, limit = 10): RssItem[] {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const items: RssItem[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const block of blocks) {
    const title = extractTitle(block);
    const url = extractLink(block);
    if (title && url) items.push({ title, url });
    if (items.length >= limit) break;
  }
  return items;
}
