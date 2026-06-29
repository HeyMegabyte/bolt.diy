/**
 * @module services/search_indexer
 * @description Pagefind-compatible search index entry builder for generated sites.
 * Pure, deterministic text processing — no I/O, no external deps.
 *
 * Produces JSONL (one JSON object per line) consumable by Pagefind and other
 * static-search indexers. Each entry carries an id, title, full-text content,
 * URL, section label, and optional language tag.
 *
 * @packageDocumentation
 */

/** A single search-index entry mapped to Pagefind's expected shape. */
export interface SearchEntry {
  /** Unique identifier (site-relative, e.g. 'about-our-mission'). */
  id: string;
  /** Page or section title. */
  title: string;
  /** Full plain-text content (HTML stripped). */
  content: string;
  /** Absolute or relative URL path. */
  url: string;
  /** Section/collection label (e.g. 'Blog', 'Services'). */
  section: string;
  /** BCP-47 language tag (default 'en' when omitted). */
  language?: string;
}

/**
 * The canonical field names for a search index entry. Useful when building
 * typed queries or schema validators that mirror the index format.
 */
export const SEARCH_INDEX_FIELDS = ['title', 'content', 'url', 'section'] as const;

/**
 * Serialise an array of search entries into JSONL (one JSON object per line),
 * the interchange format consumed by Pagefind and similar static-search tools.
 *
 * Pure + deterministic — same input always produces identical output.
 *
 * @param entries - The search entries to serialise.
 * @returns A JSONL string where each line is a valid JSON {@link SearchEntry}.
 *
 * @example
 * const jsonl = buildSearchIndex([
 *   { id: 'about', title: 'About Us', content: 'We serve…', url: '/about', section: 'Company' },
 * ]);
 * // → '{"id":"about","title":"About Us","content":"We serve…","url":"/about","section":"Company","language":"en"}\n'
 */
export function buildSearchIndex(entries: readonly SearchEntry[]): string {
  if (entries.length === 0) return '';

  return (
    entries
      .map((e) => {
        const record: SearchEntry = {
          content: e.content,
          id: e.id,
          language: e.language ?? 'en',
          section: e.section,
          title: e.title,
          url: e.url,
        };
        return JSON.stringify(record);
      })
      .join('\n') + '\n'
  );
}

/**
 * Extract the searchable title, plain body text, and heading hierarchy from an
 * HTML string. Intended for use in static-build pipelines before index creation.
 *
 * Processing steps:
 * 1. Extract `<title>` content as the title.
 * 2. Strip `<script>`, `<style>`, and SVG elements and their children.
 * 3. Extract `<h1>` through `<h6>` text content into the `headings` array.
 * 4. Strip all remaining HTML tags and normalise whitespace for `bodyText`.
 *
 * @param html - Raw HTML markup (may be a full document or a fragment).
 * @returns An object with the extracted {@link SearchEntry}-compatible fields.
 *
 * @example
 * extractSearchableText('<html><head><title>About</title></head><body><h1>Our Story</h1><p>Hello world.</p></body></html>');
 * // → { title: 'About', bodyText: 'Our Story Hello world.', headings: ['Our Story'] }
 */
export function extractSearchableText(html: string): {
  title: string;
  bodyText: string;
  headings: string[];
} {
  const raw = html ?? '';

  // 1. Extract <title>.
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  const title = titleMatch ? stripHtmlTags(titleMatch[1]).trim() : '';

  // 2. Remove <script>, <style>, <svg> blocks so tag-stripping doesn't
  //    retain their (often large, meaningless) content.
  const stripped = raw.replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // 3. Extract heading text.
  const headingRegex = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: string[] = [];
  let headingMatch: RegExpExecArray | null;
  while ((headingMatch = headingRegex.exec(stripped)) !== null) {
    const text = stripHtmlTags(headingMatch[2]).trim();
    if (text) headings.push(text);
  }

  // 4. Strip all remaining tags for body text.
  const bodyText = stripHtmlTags(stripped).replace(/\s+/g, ' ').trim();

  return { bodyText, headings, title };
}

/**
 * Remove all HTML/XML tags from a string while preserving text content.
 * Handles self-closing tags (`<br />`) and malformed input gracefully.
 *
 * Pure + deterministic; never throws.
 *
 * @param html - The raw HTML string to strip tags from.
 * @returns Plain text with tags removed and entities decoded.
 *
 * @example
 * stripHtmlTags('<p>Hello <b>world</b>!</p>');
 * // → 'Hello world!'
 *
 * @example
 * stripHtmlTags('<br/>');
 * // → ''
 *
 * @example
 * stripHtmlTags('  <div>  spaced  </div>  ');
 * // → '  spaced  '
 */
export function stripHtmlTags(html: string): string {
  if (!html) return '';

  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}
