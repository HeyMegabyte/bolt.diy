/**
 * @module services/content_import
 * @description Pure parsers for ingesting content from third‑party platforms.
 *
 * Each parser takes a raw string from the source platform and returns a
 * normalised `ContentItem[]`. Supported sources: WordPress (XML‑RSS export),
 * Squarespace (JSON export), Wix (CSV export), Webflow (JSON export),
 * generic CSV, and RSS/Atom feeds.
 *
 * ## Source formats
 *
 * | `ContentSource` | Expected shape                  | Detection hints                      |
 * | --------------- | ------------------------------- | ------------------------------------ |
 * | `wordpress`     | XML-RSS (`<rss><channel><item>`) | `<?xml` + `<generator>WordPress</>`  |
 * | `squarespace`   | JSON array of pages             | Top‑level `[]`, each has `title` + `body` |
 * | `wix`           | CSV with `title,body,slug,…`    | First row header contains `"title"`  |
 * | `webflow`       | JSON array of CMS items         | Top‑level `[]`, each has `_id` + `slug` |
 * | `csv`           | Generic CSV with header row     | `Content-Type` or filename `.csv`    |
 * | `rss`           | RSS 2.0 / Atom XML              | `<rss version="2.0">` or `<feed`     |
 *
 * @packageDocumentation
 */

/** Supported content source platforms. */
export type ContentSource = 'wordpress' | 'squarespace' | 'wix' | 'webflow' | 'csv' | 'rss';

/** A single normalised content item extracted from a source export. */
export interface ContentItem {
  /** Display title of the content. */
  title: string;
  /** Full body / HTML content. */
  body: string;
  /** URL‑safe slug derived from the title. */
  slug: string;
  /** ISO‑8601 date the item was originally published. */
  publishedAt: string;
  /** Optional author attribution. */
  author?: string;
  /** Optional list of tags or categories. */
  tags?: string[];
}

/** All supported content source platform identifiers (frozen — runtime‑immutable). */
export const CONTENT_SOURCES: readonly ContentSource[] = Object.freeze([
  'wordpress',
  'squarespace',
  'wix',
  'webflow',
  'csv',
  'rss',
]);

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Parse a raw string from a given content source into normalised ContentItems.
 *
 * @param source - The source platform identifier.
 * @param raw    - The raw export payload (XML, JSON, or CSV text).
 * @returns An array of normalised content items.
 *
 * @example
 * parseContent('squarespace', '[{"title":"Hello","body":"<p>World</p>","slug":"hello","publishOn":"2026-01-15"}]');
 * // → [{ title: 'Hello', body: '<p>World</p>', slug: 'hello', publishedAt: '2026-01-15' }]
 *
 * @example
 * parseContent('rss', '<?xml version="1.0"?><rss version="2.0"><channel><item><title>Post</title></item></channel></rss>');
 * // → [{ title: 'Post', body: '', slug: 'post', publishedAt: '', tags: [] }]
 *
 * @throws {ContentImportError} When the raw input cannot be parsed for the given source type.
 */
export function parseContent(source: ContentSource, raw: string): ContentItem[] {
  switch (source) {
    case 'wordpress':
      return parseWordPress(raw);
    case 'squarespace':
      return parseSquarespace(raw);
    case 'wix':
      return parseWixCsv(raw);
    case 'webflow':
      return parseWebflow(raw);
    case 'csv':
      return parseGenericCsv(raw);
    case 'rss':
      return parseRss(raw);
    default: {
      // Exhaustiveness guard — the union above covers every branch.
      const _exhaustive: never = source;
      throw new ContentImportError(`Unknown content source: ${_exhaustive}`);
    }
  }
}

/**
 * Convert a title into a URL‑safe slug.
 *
 * Lower‑cases, replaces non‑alphanumeric runs with a single hyphen, and
 * truncates to 80 characters (removing trailing hyphens).
 *
 * @param title - The source title string.
 * @returns A URL‑safe slug ≤80 characters.
 *
 * @example
 * slugify('  Hello World!  ') // → 'hello-world'
 * slugify('A very long title that definitely exceeds the eighty character limit in length') // → 'a-very-long-title-that-definitely-exceeds-the-eighty-character-limit-in-len'
 * slugify('')                 // → ''
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

// ─── Error types ─────────────────────────────────────────────────────────

/**
 * Thrown when a content import cannot be parsed for its source type.
 *
 * @example
 * throw new ContentImportError('Expected XML root element');
 */
export class ContentImportError extends Error {
  override readonly name = 'ContentImportError' as const;
}

// ─── WordPress XML-RSS ───────────────────────────────────────────────────

function parseWordPress(raw: string): ContentItem[] {
  const items: ContentItem[] = [];
  const itemRegex = /<item>[\s\S]*?<\/item>/gi;
  let itemMatch: RegExpExecArray | null;

  while ((itemMatch = itemRegex.exec(raw)) !== null) {
    const block = itemMatch[0];

    const title = extractXmlValue(block, 'title');
    const contentEncoded = extractXmlCdataValue(block, 'content:encoded') || extractXmlValue(block, 'description');
    const wpSlug = extractXmlValue(block, 'wp:post_name');
    const pubDate = extractXmlValue(block, 'pubDate');
    const author = extractXmlValue(block, 'dc:creator');
    const categoryTags = extractXmlValues(block, 'category');

    if (!title && !contentEncoded) continue;

    const slug = wpSlug || slugify(title);
    const body = (contentEncoded || '').trim();
    const publishedAt = parseRssDate(pubDate);
    const tags = categoryTags.length > 0 ? categoryTags : undefined;

    items.push({ author: author || undefined, body, publishedAt, slug, tags, title: title || slug });
  }

  return items;
}

// ─── Squarespace JSON Export ─────────────────────────────────────────────

interface SquarespacePage {
  title?: string;
  body?: string;
  slug?: string;
  publishOn?: string;
  publishDate?: string;
  author?: string;
  tags?: string[];
  categories?: string[];
}

function parseSquarespace(raw: string): ContentItem[] {
  if (!raw.trim()) return [];
  let pages: SquarespacePage[];
  try {
    pages = JSON.parse(raw) as SquarespacePage[];
    if (!Array.isArray(pages)) throw new ContentImportError('Squarespace export must be a JSON array');
  } catch (cause) {
    throw new ContentImportError('Invalid Squarespace JSON export – expected a JSON array', { cause });
  }

  return pages
    .filter((p): p is SquarespacePage & { title: string } => typeof p.title === 'string' && p.title.length > 0)
    .map((p) => {
      const publishedAt = isoDate(p.publishOn ?? p.publishDate ?? '');
      const tags = p.tags ?? p.categories;
      return {
        author: p.author,
        body: (p.body ?? '').trim(),
        publishedAt,
        slug: p.slug ?? slugify(p.title),
        tags: tags?.length ? tags : undefined,
        title: p.title,
      };
    });
}

// ─── Wix CSV Export ──────────────────────────────────────────────────────

function parseWixCsv(raw: string): ContentItem[] {
  // Wix column order (first row is header): title, body, slug, publishedAt, author, tags
  return parseGenericCsv(raw, {
    title: 'title',
    body: 'body',
    slug: 'slug',
    publishedAt: 'publishdate',
    author: 'author',
    tags: 'tags',
  });
}

// ─── Webflow JSON Export ─────────────────────────────────────────────────

interface WebflowItem {
  _id?: string;
  slug?: string;
  name?: string;
  'post-body'?: string;
  'post-summary'?: string;
  'updated-on'?: string;
  'published-on'?: string;
  'created-on'?: string;
  'author-name'?: string;
  tags?: string[];
}

function parseWebflow(raw: string): ContentItem[] {
  if (!raw.trim()) return [];
  let items: WebflowItem[];
  try {
    items = JSON.parse(raw) as WebflowItem[];
    if (!Array.isArray(items)) throw new ContentImportError('Webflow export must be a JSON array');
  } catch (cause) {
    throw new ContentImportError('Invalid Webflow JSON export – expected a JSON array', { cause });
  }

  return items
    .filter((i) => i.slug)
    .map((i) => {
      const title = i.name ?? i.slug!;
      const body = (i['post-body'] ?? i['post-summary'] ?? '').trim();
      const publishedAt = isoDate(i['published-on'] ?? i['updated-on'] ?? i['created-on'] ?? '');
      return {
        author: i['author-name'] || undefined,
        body,
        publishedAt,
        slug: i.slug!,
        tags: i.tags?.length ? i.tags : undefined,
        title,
      };
    });
}

// ─── Generic CSV ─────────────────────────────────────────────────────────

interface CsvColumnMapping {
  title: string;
  body: string;
  slug: string;
  publishedAt: string;
  author?: string;
  tags?: string;
}

function parseGenericCsv(raw: string, mapping?: CsvColumnMapping): ContentItem[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ''));

  const col = (name: string): number | null => {
    const idx = header.indexOf(name);
    return idx >= 0 ? idx : null;
  };

  const tCol = mapping ? col(mapping.title) : col('title');
  const bCol = mapping ? col(mapping.body) : col('body');
  const sCol = mapping ? col(mapping.slug) : col('slug');
  const pCol = mapping ? col(mapping.publishedAt) : col('publishedat') ?? col('published_at') ?? col('publishdate');
  const aCol = mapping?.author ? col(mapping.author) : col('author');
  const tgCol = mapping?.tags ? col(mapping.tags) : col('tags');

  const items: ContentItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const title = tCol !== null ? (values[tCol] ?? '').trim() : '';
    const body = bCol !== null ? (values[bCol] ?? '').trim() : '';
    const slug = sCol !== null ? (values[sCol] ?? '').trim() : (title ? slugify(title) : '');
    const rawDate = pCol !== null ? (values[pCol] ?? '').trim() : '';
    const author = aCol !== null ? (values[aCol] ?? '').trim() || undefined : undefined;
    const rawTags = tgCol !== null ? (values[tgCol] ?? '').trim() : '';

    if (!title && !body) continue;

    items.push({
      author,
      body,
      publishedAt: isoDate(rawDate),
      slug: slug || slugify(title),
      tags: rawTags ? rawTags.split(/;\s*/).filter(Boolean) : undefined,
      title: title || slug || 'Untitled',
    });
  }

  return items;
}

// ─── RSS 2.0 / Atom Feed ────────────────────────────────────────────────

function parseRss(raw: string): ContentItem[] {
  const items: ContentItem[] = [];

  // Atom <entry> pattern
  const entryRegex = /<entry>[\s\S]*?<\/entry>/gi;
  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entryRegex.exec(raw)) !== null) {
    const block = entryMatch[0];
    const title = extractXmlValue(block, 'title');
    const content = extractXmlValue(block, 'content') || extractXmlValue(block, 'summary');
    const id = extractXmlValue(block, 'id');
    const published = extractXmlValue(block, 'published') || extractXmlValue(block, 'updated');
    const authorName = extractXmlChildValue(block, 'author', 'name');
    const tags = extractXmlValues(block, 'category').map((c) => c.replace(/^.*?label="([^"]+)".*$|^.*?term="([^"]+)".*$/s, '$1$2'));

    const slug = id ? slugify(slugFromEntryId(id) || title) : slugify(title);

    items.push({
      author: authorName || undefined,
      body: (content || '').trim(),
      publishedAt: isoDate(published),
      slug,
      tags: tags.length > 0 ? tags : undefined,
      title: title || slug,
    });
  }

  // RSS 2.0 <item> pattern (fallback)
  if (items.length === 0) {
    return parseWordPress(raw);
  }

  return items;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Extract a human‑readable slug suffix from an Atom `<id>` element value.
 *
 * Handles tag URIs (`tag:domain,date:slug` → `slug`), plain URLs
 * (`https://example.com/posts/my-slug` → `my-slug`), and opaque
 * identifiers (`urn:uuid:...` → empty string).
 */
function slugFromEntryId(id: string): string {
  // tag:domain,date:slug → extract the part after the last colon before
  // any slash or at the end. Handles both YYYY-MM-DD and YYYY suffices.
  const tagMatch = /^tag:.*,(?:\d{4}(?:-\d{2}-\d{2})?):(.+)$/.exec(id);
  if (tagMatch) return tagMatch[1];

  // Plain URL: extract the last path segment
  try {
    const url = new URL(id);
    const seg = url.pathname.replace(/\/?$/, '').split('/').pop();
    if (seg) return seg;
  } catch {
    // Not a valid URL — fall through
  }

  return '';
}
function extractXmlValue(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  if (!m) return '';
  // Strip CDATA wrapper if present
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

/** Extract all text content values for a given XML tag within the block. */
function extractXmlValues(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim());
  }
  return results;
}

/** Extract text content of a child element by parent + child tag names. */
function extractXmlChildValue(xml: string, parentTag: string, childTag: string): string {
  const parentRe = new RegExp(`<${parentTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${parentTag}>`, 'i');
  const parentM = parentRe.exec(xml);
  if (!parentM) return '';
  return extractXmlValue(parentM[1], childTag);
}

/** Extract CDATA‑wrapped content: `<tag><![CDATA[...]]></tag>`. */
function extractXmlCdataValue(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() : '';
}

/** Normalise an RSS date string to an ISO‑8601 date. Falls back to empty string. */
function parseRssDate(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Normalise any date‑like value to YYYY‑MM‑DD (or full ISO when time present). */
function isoDate(raw: string): string {
  if (!raw) return '';
  // Already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Parse a single CSV line respecting double‑quoted fields (RFC‑4180).
 *
 * Splits on commas that are not inside double quotes. Collapses escaped
 * `""` back to `"` within quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // Escaped quote: `""`
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);

  return values;
}
