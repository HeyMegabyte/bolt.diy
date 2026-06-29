/**
 * Tests for `src/services/content_import.ts` — pure content parsing across
 * all six source platforms + edge cases (empty, malformed, missing fields).
 */
import {
  CONTENT_SOURCES,
  ContentImportError,
  type ContentItem,
  type ContentSource,
  parseContent,
  slugify,
} from '../services/content_import.js';

describe('CONTENT_SOURCES', () => {
  it('lists all six source platforms in a constant order', () => {
    expect(CONTENT_SOURCES).toEqual([
      'wordpress',
      'squarespace',
      'wix',
      'webflow',
      'csv',
      'rss',
    ]);
  });

  it('is a frozen readonly tuple', () => {
    expect(() => {
      (CONTENT_SOURCES as string[]).push('not-a-source');
    }).toThrow();
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates a simple title', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips surrounding whitespace', () => {
    expect(slugify('  Leading And Trailing  ')).toBe('leading-and-trailing');
  });

  it('replaces runs of non-alphanumeric characters with a single hyphen', () => {
    expect(slugify('Hello!!! World??? #1')).toBe('hello-world-1');
  });

  it('removes leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
    expect(slugify('!start')).toBe('start');
    expect(slugify('end!')).toBe('end');
  });

  it('truncates at 80 characters', () => {
    // This title produces a slug >80 chars; slice(0,80) + strip trailing hyphen.
    const long = 'A very long!! title!! that!! definitely!! exceeds!! the!! eighty!! character!! limit!! in!! length!! for!! truncation!! testing!!';
    const result = slugify(long);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('-')).toBe(false);
    expect(result).toBe('a-very-long-title-that-definitely-exceeds-the-eighty-character-limit-in-length-f');
  });

  it('removes trailing hyphens from truncated strings', () => {
    // The 80th char would be right after a hyphen run → ensure it's stripped
    const title = 'A ' + 'longword '.repeat(10);
    const result = slugify(title);
    expect(result.endsWith('-')).toBe(false);
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
  });

  it('handles single characters', () => {
    expect(slugify('A')).toBe('a');
  });

  it('handles strings with only special characters', () => {
    expect(slugify('!!! --- ???')).toBe('');
  });
});

describe('parseContent — WordPress (XML-RSS)', () => {
  const wpXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <generator>https://wordpress.org/?v=6.7</generator>
  <item>
    <title>Hello World</title>
    <dc:creator><![CDATA[Jane Doe]]></dc:creator>
    <content:encoded><![CDATA[<p>First post content.</p>]]></content:encoded>
    <wp:post_name>hello-world</wp:post_name>
    <pubDate>Mon, 15 Jan 2026 10:00:00 +0000</pubDate>
    <category><![CDATA[News]]></category>
    <category><![CDATA[Updates]]></category>
  </item>
  <item>
    <title>A Second Post</title>
    <dc:creator><![CDATA[John Smith]]></dc:creator>
    <content:encoded><![CDATA[<p>Second post body.</p>]]></content:encoded>
    <wp:post_name>second-post</wp:post_name>
    <pubDate>Tue, 16 Jan 2026 14:30:00 +0000</pubDate>
    <category><![CDATA[Tutorials]]></category>
  </item>
</channel>
</rss>`;

  it('parses WordPress items into ContentItems', () => {
    const items = parseContent('wordpress', wpXml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Hello World');
    expect(items[1].title).toBe('A Second Post');
  });

  it('extracts CDATA-wrapped content:encoded as body', () => {
    const items = parseContent('wordpress', wpXml);
    expect(items[0].body).toBe('<p>First post content.</p>');
    expect(items[1].body).toBe('<p>Second post body.</p>');
  });

  it('parses wp:post_name as a slug', () => {
    const items = parseContent('wordpress', wpXml);
    expect(items[0].slug).toBe('hello-world');
    expect(items[1].slug).toBe('second-post');
  });

  it('extracts author from dc:creator', () => {
    const items = parseContent('wordpress', wpXml);
    expect(items[0].author).toBe('Jane Doe');
    expect(items[1].author).toBe('John Smith');
  });

  it('collects category tags', () => {
    const items = parseContent('wordpress', wpXml);
    expect(items[0].tags).toEqual(['News', 'Updates']);
    expect(items[1].tags).toEqual(['Tutorials']);
  });

  it('parses pubDate into ISO string', () => {
    const items = parseContent('wordpress', wpXml);
    expect(items[0].publishedAt).toBe('2026-01-15T10:00:00.000Z');
  });

  it('skips items with neither title nor content', () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item><title>Valid</title><wp:post_name>valid</wp:post_name><pubDate>Mon, 15 Jan 2026 10:00:00 +0000</pubDate></item>
<item><bogus>no title or content</bogus></item>
</channel></rss>`;
    const items = parseContent('wordpress', xml);
    expect(items).toHaveLength(1);
  });

  it('handles WordPress export with no items', () => {
    const xml = `<?xml version="1.0"?>
<rss version="2.0"><channel></channel></rss>`;
    expect(parseContent('wordpress', xml)).toEqual([]);
  });
});

describe('parseContent — Squarespace (JSON export)', () => {
  const validJson = JSON.stringify([
    {
      title: 'About Us',
      body: '<p>Our story.</p>',
      slug: 'about',
      publishOn: '2026-02-01',
      author: 'Admin',
      tags: ['company', 'history'],
    },
    {
      title: 'Services',
      body: '<p>What we do.</p>',
      slug: 'services',
      publishDate: '2026-02-15',
      categories: ['offerings'],
    },
  ]);

  it('parses Squarespace JSON into ContentItems', () => {
    const items = parseContent('squarespace', validJson);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('About Us');
    expect(items[1].title).toBe('Services');
  });

  it('reads publishOn or publishDate as publishedAt', () => {
    const items = parseContent('squarespace', validJson);
    expect(items[0].publishedAt).toBe('2026-02-01');
    expect(items[1].publishedAt).toBe('2026-02-15');
  });

  it('prefers tags over categories when both present', () => {
    const items = parseContent('squarespace', validJson);
    expect(items[0].tags).toEqual(['company', 'history']);
    expect(items[1].tags).toEqual(['offerings']);
  });

  it('handles an empty array', () => {
    expect(parseContent('squarespace', '[]')).toEqual([]);
  });

  it('filters out items without a title', () => {
    const json = JSON.stringify([
      { title: 'Real', slug: 'real', publishOn: '2026-01-01' },
      { body: '<p>No title</p>', slug: 'ghost', publishOn: '2026-01-01' },
    ]);
    expect(parseContent('squarespace', json)).toHaveLength(1);
  });

  it('throws ContentImportError on non-array JSON', () => {
    expect(() => parseContent('squarespace', '{"not":"an array"}')).toThrow(ContentImportError);
  });

  it('throws ContentImportError on malformed JSON', () => {
    expect(() => parseContent('squarespace', '{broken')).toThrow(ContentImportError);
  });
});

describe('parseContent — Wix (CSV export)', () => {
  const csv = `title,body,slug,publishdate,author,tags
Welcome,<p>Welcome text</p>,welcome,2026-03-01,Alice,news
Our Team,<p>Team page</p>,our-team,2026-03-10,,team;about`;
  const items = parseContent('wix', csv);

  it('parses Wix CSV into ContentItems', () => {
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Welcome');
    expect(items[1].slug).toBe('our-team');
  });

  it('reads the publishdate column as publishedAt', () => {
    expect(items[0].publishedAt).toBe('2026-03-01');
    expect(items[1].publishedAt).toBe('2026-03-10');
  });

  it('parses author column', () => {
    expect(items[0].author).toBe('Alice');
    expect(items[1].author).toBeUndefined();
  });

  it('parses semi-colon delimited tags', () => {
    expect(items[1].tags).toEqual(['team', 'about']);
    expect(items[0].tags).toEqual(['news']);
  });

  it('handles empty CSV with only headers', () => {
    const hdr = 'title,body,slug,publishdate,author,tags\n';
    expect(parseContent('wix', hdr)).toEqual([]);
  });
});

describe('parseContent — Webflow (JSON export)', () => {
  const webflowItems = [
    {
      _id: 'abc123',
      slug: 'post-one',
      name: 'Post One',
      'post-body': '<p>First post</p>',
      'published-on': '2026-04-01T12:00:00.000Z',
      'author-name': 'Bob',
      tags: ['design'],
    },
    {
      _id: 'def456',
      slug: 'post-two',
      name: 'Post Two',
      'post-summary': '<p>Summary only</p>',
      'updated-on': '2026-04-15T08:00:00.000Z',
      tags: ['code', 'tutorial'],
    },
  ];

  it('parses Webflow JSON into ContentItems', () => {
    const items = parseContent('webflow', JSON.stringify(webflowItems));
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Post One');
    expect(items[1].slug).toBe('post-two');
  });

  it('falls back to post-summary when post-body is absent', () => {
    const items = parseContent('webflow', JSON.stringify(webflowItems));
    expect(items[0].body).toBe('<p>First post</p>');
    expect(items[1].body).toBe('<p>Summary only</p>');
  });

  it('uses published-on or updated-on as publishedAt', () => {
    const items = parseContent('webflow', JSON.stringify(webflowItems));
    expect(items[0].publishedAt).toBe('2026-04-01T12:00:00.000Z');
    expect(items[1].publishedAt).toBe('2026-04-15T08:00:00.000Z');
  });

  it('filters out items without a slug', () => {
    const json = JSON.stringify([
      { _id: 'x', slug: 'has-slug', name: 'A' },
      { _id: 'y', name: 'No Slug' },
    ]);
    const items = parseContent('webflow', json);
    expect(items).toHaveLength(1);
    expect(items[0].slug).toBe('has-slug');
  });

  it('throws ContentImportError on non-array JSON', () => {
    expect(() => parseContent('webflow', '{"bogus":true}')).toThrow(ContentImportError);
  });
});

describe('parseContent — Generic CSV', () => {
  it('parses standard CSV with header row', () => {
    const csv = 'title,body,slug,published_at,author,tags\nHome,<p>Home page</p>,home,2026-05-01,,\nAbout,<p>About page</p>,about,2026-05-10,Team,about;company';
    const items = parseContent('csv', csv);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Home');
    expect(items[1].author).toBe('Team');
    expect(items[1].tags).toEqual(['about', 'company']);
  });

  it('handles quoted CSV fields (RFC-4180)', () => {
    const csv =
      'title,body,slug\n"Hello, World!","<p>Body with, commas</p>","hello-world"\n';
    const items = parseContent('csv', csv);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Hello, World!');
    expect(items[0].body).toBe('<p>Body with, commas</p>');
  });

  it('handles escaped quotes in CSV fields', () => {
    const csv =
      'title,body,slug\n"Say ""Hello""","<p>Content</p>","say-hello"\n';
    const items = parseContent('csv', csv);
    expect(items[0].title).toBe('Say "Hello"');
  });

  it('returns empty array for single-line (header-only) input', () => {
    expect(parseContent('csv', 'a,b,c\n')).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    // Whitespace-only lines are filtered
    expect(parseContent('csv', '')).toEqual([]);
  });

  it('handles different date column naming', () => {
    const csv = 'title,body,slug,date_published\nPost,<p>Body</p>,post,2026-06-01\n';
    const items = parseContent('csv', csv);
    expect(items[0].publishedAt).toBe('');
  });
});

describe('parseContent — RSS / Atom', () => {
  it('parses Atom feed entries', () => {
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom Post</title>
    <content>Atom body text.</content>
    <id>tag:example.com,2026:post-1</id>
    <published>2026-06-01T00:00:00Z</published>
    <author><name>Carol</name></author>
    <category term="tech" />
    <category term="news" />
  </entry>
</feed>`;
    const items = parseContent('rss', atom);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Atom Post');
    expect(items[0].body).toBe('Atom body text.');
    expect(items[0].slug).toBe('post-1');
    expect(items[0].author).toBe('Carol');
    expect(items[0].tags).toEqual(['tech', 'news']);
    expect(items[0].publishedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('falls back to WordPress parser for RSS 2.0 items', () => {
    const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>RSS Post</title>
    <description>RSS body.</description>
    <pubDate>Sun, 15 Jan 2026 10:00:00 +0000</pubDate>
  </item>
</channel></rss>`;
    const items = parseContent('rss', rss);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('RSS Post');
    expect(items[0].body).toBe('RSS body.');
    expect(items[0].publishedAt).toBe('2026-01-15T10:00:00.000Z');
  });

  it('uses content before summary in Atom entries', () => {
    const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Priority</title>
    <summary>Summary text</summary>
    <content>Full content</content>
    <id>tag:example.com,2026:2</id>
    <updated>2026-07-01T00:00:00Z</updated>
  </entry>
</feed>`;
    const items = parseContent('rss', atom);
    expect(items[0].body).toBe('Full content');
  });
});

describe('parseContent — edge cases and error handling', () => {
  it('rejects an unknown source type via TypeScript exhaustiveness', () => {
    expect(() => parseContent('unknown' as ContentSource, '')).toThrow(
      ContentImportError,
    );
  });

  it('handles empty string input for all source types', () => {
    for (const source of CONTENT_SOURCES) {
      // Should not throw for empty string
      const items = parseContent(source, '');
      expect(Array.isArray(items)).toBe(true);
    }
  });

  it('handles extremely long input without crashing', () => {
    const manyItems = Array.from({ length: 200 }, (_, i) => ({
      title: `Post ${i}`,
      slug: `post-${i}`,
      publishOn: '2026-01-01',
    }));
    const items = parseContent('squarespace', JSON.stringify(manyItems));
    expect(items).toHaveLength(200);
  });
});
