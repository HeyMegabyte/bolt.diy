import { parseRssFeed, buildRssDraftRows } from '../services/rss_import';

/**
 * Guards the pure RSS/Atom feed parser behind Pulse Social's import-from-RSS
 * preview: RSS items, Atom entries, CDATA + entity-decoded titles, link-rel
 * preference, limit cap, and malformed-input → [] (never throws).
 */
describe('parseRssFeed', () => {
  it('parses RSS <item> title + link', () => {
    const xml = `<rss><channel>
      <item><title>First post</title><link>https://blog.com/1</link></item>
      <item><title>Second post</title><link>https://blog.com/2</link></item>
    </channel></rss>`;
    expect(parseRssFeed(xml)).toEqual([
      { title: 'First post', url: 'https://blog.com/1' },
      { title: 'Second post', url: 'https://blog.com/2' },
    ]);
  });

  it('parses Atom <entry> with link href (prefers a content rel over self)', () => {
    const xml = `<feed>
      <entry>
        <title>Atom one</title>
        <link rel="self" href="https://api.site.com/feed/1"/>
        <link rel="alternate" href="https://site.com/atom-one"/>
      </entry>
    </feed>`;
    expect(parseRssFeed(xml)).toEqual([{ title: 'Atom one', url: 'https://site.com/atom-one' }]);
  });

  it('decodes CDATA titles and XML entities', () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Tom & Jerry's <b>Big</b> Day]]></title><link>https://x.com/a</link></item>
      <item><title>Cats &amp; Dogs &#39;24</title><link>https://x.com/b</link></item>
    </channel></rss>`;
    const out = parseRssFeed(xml);
    expect(out[0]).toEqual({ title: "Tom & Jerry's <b>Big</b> Day", url: 'https://x.com/a' });
    expect(out[1]).toEqual({ title: "Cats & Dogs '24", url: 'https://x.com/b' });
  });

  it('caps results at the limit', () => {
    const items = Array.from({ length: 25 }, (_, i) => `<item><title>P${i}</title><link>https://x.com/${i}</link></item>`).join('');
    expect(parseRssFeed(`<rss><channel>${items}</channel></rss>`, 10).length).toBe(10);
  });

  it('skips items missing a title or a link', () => {
    const xml = `<rss><channel>
      <item><title>No link here</title></item>
      <item><link>https://x.com/no-title</link></item>
      <item><title>Good</title><link>https://x.com/good</link></item>
    </channel></rss>`;
    expect(parseRssFeed(xml)).toEqual([{ title: 'Good', url: 'https://x.com/good' }]);
  });

  it('returns [] for empty/malformed input without throwing', () => {
    expect(parseRssFeed('')).toEqual([]);
    expect(parseRssFeed('not xml at all')).toEqual([]);
    expect(parseRssFeed('<rss><channel></channel></rss>')).toEqual([]);
    expect(parseRssFeed(undefined as unknown as string)).toEqual([]);
  });
});

describe('buildRssDraftRows', () => {
  it('maps items to draft payloads (content = title + url, link = url)', () => {
    expect(buildRssDraftRows([
      { title: 'First', url: 'https://x.com/a' },
      { title: 'Second', url: 'https://x.com/b' },
    ])).toEqual([
      { content: 'First\n\nhttps://x.com/a', link: 'https://x.com/a' },
      { content: 'Second\n\nhttps://x.com/b', link: 'https://x.com/b' },
    ]);
  });

  it('returns [] for no items', () => {
    expect(buildRssDraftRows([])).toEqual([]);
  });
});
