import { parseOgTags } from '../services/og_preview';

/**
 * Guards the pure OG/Twitter-card meta parser behind Pulse Social's link
 * preview: og:* precedence over twitter:* over <title>, entity decode, image +
 * site_name, and malformed input → {} (never throws).
 */
describe('parseOgTags', () => {
  it('extracts og:* fields', () => {
    const html = `<head>
      <meta property="og:title" content="Great Article">
      <meta property="og:description" content="A summary here">
      <meta property="og:image" content="https://cdn.site.com/img.png">
      <meta property="og:site_name" content="Site Co">
    </head>`;
    expect(parseOgTags(html)).toEqual({
      title: 'Great Article',
      description: 'A summary here',
      image: 'https://cdn.site.com/img.png',
      site_name: 'Site Co',
    });
  });

  it('prefers og:title over twitter:title and falls back to <title>', () => {
    expect(parseOgTags('<meta property="og:title" content="OG"><meta name="twitter:title" content="TW"><title>T</title>').title).toBe('OG');
    expect(parseOgTags('<meta name="twitter:title" content="TW"><title>T</title>').title).toBe('TW');
    expect(parseOgTags('<title>Just Title</title>').title).toBe('Just Title');
  });

  it('falls back to name="description" and twitter:image', () => {
    const og = parseOgTags('<meta name="description" content="Meta desc"><meta name="twitter:image" content="https://x.com/t.png">');
    expect(og.description).toBe('Meta desc');
    expect(og.image).toBe('https://x.com/t.png');
  });

  it('decodes HTML entities in content', () => {
    expect(parseOgTags('<meta property="og:title" content="Tom &amp; Jerry &#39;24">').title).toBe("Tom & Jerry '24");
  });

  it('returns {} for empty/malformed input without throwing', () => {
    expect(parseOgTags('')).toEqual({});
    expect(parseOgTags('<html><body>no meta</body></html>')).toEqual({});
    expect(parseOgTags(undefined as unknown as string)).toEqual({});
  });
});
