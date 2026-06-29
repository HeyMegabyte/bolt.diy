import {
  buildSearchIndex,
  extractSearchableText,
  SEARCH_INDEX_FIELDS,
  stripHtmlTags,
} from '../services/search_indexer.js';

describe('stripHtmlTags', () => {
  it('removes simple tags', () => {
    expect(stripHtmlTags('<p>Hello</p>').trim()).toBe('Hello');
  });

  it('handles nested tags', () => {
    expect(stripHtmlTags('<div><p>Nested</p></div>').trim()).toBe('Nested');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtmlTags('')).toBe('');
  });

  it('decodes common HTML entities', () => {
    expect(stripHtmlTags('&amp; &lt; &gt; &quot;')).toBe('& < > "');
  });

  it('handles self-closing tags', () => {
    expect(stripHtmlTags('<br/>Hello<br />world').replace(/\s+/g, ' ').trim()).toBe('Hello world');
  });

  it('preserves text when no tags exist', () => {
    expect(stripHtmlTags('plain text')).toBe('plain text');
  });
});

describe('extractSearchableText', () => {
  it('extracts title, body, and headings from a full document', () => {
    const html =
      '<html><head><title>About Us</title></head><body><h1>Our Story</h1><p>We build things.</p></body></html>';
    const result = extractSearchableText(html);
    expect(result.title).toBe('About Us');
    expect(result.bodyText).toContain('Our Story');
    expect(result.bodyText).toContain('We build things.');
    expect(result.headings).toContain('Our Story');
  });

  it('omits script and style content from body text', () => {
    const html =
      '<html><head><title>Page</title></head><body><script>var x=1;</script><style>.cls{}</style><p>Real content</p></body></html>';
    const result = extractSearchableText(html);
    expect(result.title).toBe('Page');
    expect(result.bodyText).not.toContain('var x');
    expect(result.bodyText).not.toContain('.cls');
    expect(result.bodyText).toContain('Real content');
  });

  it('returns an empty title when no <title> tag exists', () => {
    const result = extractSearchableText('<p>No title</p>');
    expect(result.title).toBe('');
  });

  it('extracts multiple heading levels', () => {
    const html = '<h1>H1</h1><p>a</p><h2>H2</h2><p>b</p><h3>H3</h3>';
    const result = extractSearchableText(html);
    expect(result.headings).toEqual(['H1', 'H2', 'H3']);
  });

  it('handles empty input', () => {
    const result = extractSearchableText('');
    expect(result.title).toBe('');
    expect(result.bodyText).toBe('');
    expect(result.headings).toEqual([]);
  });
});

describe('buildSearchIndex', () => {
  it('produces one JSON line per entry', () => {
    const result = buildSearchIndex([
      { id: 'a', title: 'A', content: 'a', url: '/a', section: 'S' },
      { id: 'b', title: 'B', content: 'b', url: '/b', section: 'S' },
    ]);
    const lines = result.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('a');
    expect(JSON.parse(lines[1]).id).toBe('b');
  });

  it('applies default language "en"', () => {
    const result = buildSearchIndex([
      { id: 'x', title: 'X', content: 'x', url: '/x', section: 'Test' },
    ]);
    const parsed = JSON.parse(result.trim());
    expect(parsed.language).toBe('en');
  });

  it('respects provided language tag', () => {
    const result = buildSearchIndex([
      { id: 'x', title: 'X', content: 'x', url: '/x', section: 'Test', language: 'es' },
    ]);
    const parsed = JSON.parse(result.trim());
    expect(parsed.language).toBe('es');
  });

  it('returns empty string for empty array', () => {
    expect(buildSearchIndex([])).toBe('');
  });

  it('includes every SearchEntry field in each JSON line', () => {
    const result = buildSearchIndex([
      {
        id: 'about',
        title: 'About Us',
        content: 'We serve the community.',
        url: '/about',
        section: 'Company',
      },
    ]);
    const parsed = JSON.parse(result.trim());
    expect(parsed).toMatchObject({
      id: 'about',
      title: 'About Us',
      content: 'We serve the community.',
      url: '/about',
      section: 'Company',
      language: 'en',
    });
  });

  it('terminates with a trailing newline', () => {
    const result = buildSearchIndex([
      { id: 'x', title: 'X', content: 'x', url: '/x', section: 'Test' },
    ]);
    expect(result.endsWith('\n')).toBe(true);
  });
});

describe('SEARCH_INDEX_FIELDS', () => {
  it('is a frozen tuple of 4 field names', () => {
    expect(SEARCH_INDEX_FIELDS).toEqual(['title', 'content', 'url', 'section']);
  });
});
