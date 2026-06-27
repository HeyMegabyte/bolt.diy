/**
 * cf_credentials_unit — pure-function coverage for link_shortener.ts.
 *
 * Pick: `src/services/link_shortener.ts` — `addUtm` and `extractUrls` are
 * entirely pure; `shortenViaDub` is impure (fetch) but testable via a
 * mocked global fetch. `cf_credentials.ts` is already thoroughly covered
 * by cf_credentials.test.ts (12 tests; all exports + all edge cases).
 *
 * Mocks: global `fetch` only (for shortenViaDub). No D1, no KV, no Workers.
 * Uses real URL parsing (globalThis.URL is available in Node 22).
 */

const mockFetch = jest.fn();
global.fetch = mockFetch as typeof fetch;

import { addUtm, extractUrls, shortenViaDub, processPostLinks } from '../services/link_shortener.js';
import type { UtmParams } from '../services/link_shortener.js';

// ---------------------------------------------------------------------------
// addUtm — pure UTM appender
// ---------------------------------------------------------------------------
describe('addUtm', () => {
  const utm: UtmParams = { source: 'twitter', medium: 'social', campaign: 'post123' };

  it('appends utm_source / utm_medium / utm_campaign to a plain URL', () => {
    const result = addUtm('https://example.com/page', utm);
    const u = new URL(result);
    expect(u.searchParams.get('utm_source')).toBe('twitter');
    expect(u.searchParams.get('utm_medium')).toBe('social');
    expect(u.searchParams.get('utm_campaign')).toBe('post123');
  });

  it('preserves existing query params', () => {
    const result = addUtm('https://example.com/page?a=1&b=2', utm);
    const u = new URL(result);
    expect(u.searchParams.get('a')).toBe('1');
    expect(u.searchParams.get('b')).toBe('2');
    expect(u.searchParams.get('utm_source')).toBe('twitter');
  });

  it('does NOT overwrite pre-existing utm_source', () => {
    const result = addUtm('https://example.com/?utm_source=newsletter', utm);
    const u = new URL(result);
    expect(u.searchParams.get('utm_source')).toBe('newsletter'); // kept
    expect(u.searchParams.get('utm_medium')).toBe('social');   // added
  });

  it('returns the URL unchanged for non-http/https protocols', () => {
    const ftp = 'ftp://files.example.com/data.zip';
    expect(addUtm(ftp, utm)).toBe(ftp);
  });

  it('returns the original string when it is not a valid URL', () => {
    const garbage = 'not-a-url at all';
    expect(addUtm(garbage, utm)).toBe(garbage);
  });

  it('handles empty campaign without crashing', () => {
    const emptyUtm: UtmParams = { source: 'x', medium: 'social', campaign: '' };
    const result = addUtm('https://example.com/', emptyUtm);
    // empty value must NOT be set (guard: if (!v) skip)
    expect(result).not.toContain('utm_campaign=');
  });
});

// ---------------------------------------------------------------------------
// extractUrls — pure URL extractor
// ---------------------------------------------------------------------------
describe('extractUrls', () => {
  it('extracts a single https URL', () => {
    expect(extractUrls('Check this out https://example.com/path')).toEqual([
      'https://example.com/path',
    ]);
  });

  it('extracts multiple distinct URLs in first-seen order', () => {
    const text = 'See https://a.com and also https://b.com for details.';
    expect(extractUrls(text)).toEqual(['https://a.com', 'https://b.com']);
  });

  it('deduplicates repeated occurrences of the same URL', () => {
    const text = 'https://a.com then again https://a.com';
    const urls = extractUrls(text);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://a.com');
  });

  it('strips trailing sentence punctuation', () => {
    const text = 'Visit https://example.com/path.';
    const urls = extractUrls(text);
    expect(urls).toEqual(['https://example.com/path']);
  });

  it('strips trailing comma', () => {
    const urls = extractUrls('here: https://example.com/foo,');
    expect(urls).toEqual(['https://example.com/foo']);
  });

  it('returns empty array for text with no URLs', () => {
    expect(extractUrls('Just plain text with no links.')).toEqual([]);
  });

  it('extracts both http and https URLs', () => {
    const text = 'Old: http://old.com New: https://new.com';
    expect(extractUrls(text)).toEqual(['http://old.com', 'https://new.com']);
  });
});

// ---------------------------------------------------------------------------
// shortenViaDub — impure (fetch-dependent) + fail-soft
// ---------------------------------------------------------------------------
describe('shortenViaDub', () => {
  const env = {
    DUB_API_KEY: 'test-key',
    DUB_API_BASE: 'https://app.claimyour.site/api',
    LINKBL_DOMAIN: 'linkbl.ink',
  } as unknown as Parameters<typeof shortenViaDub>[0];

  const longUrl = 'https://example.com/page?utm_source=x';

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns the shortLink from a successful Dub response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ shortLink: 'https://linkbl.ink/abc123' }), { status: 200 }),
    );
    const result = await shortenViaDub(env, longUrl);
    expect(result).toBe('https://linkbl.ink/abc123');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.claimyour.site/api/links',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to longUrl when DUB_API_KEY is absent', async () => {
    const noKey = { ...env, DUB_API_KEY: undefined } as unknown as typeof env;
    const result = await shortenViaDub(noKey, longUrl);
    expect(result).toBe(longUrl);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('falls back to longUrl on a non-ok HTTP response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));
    const result = await shortenViaDub(env, longUrl);
    expect(result).toBe(longUrl);
  });

  it('falls back to longUrl when fetch throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const result = await shortenViaDub(env, longUrl);
    expect(result).toBe(longUrl);
  });

  it('falls back to longUrl when Dub response JSON is malformed', async () => {
    mockFetch.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    const result = await shortenViaDub(env, longUrl);
    expect(result).toBe(longUrl);
  });

  it('falls back to longUrl when shortLink is missing from the response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '123' }), { status: 200 }),
    );
    const result = await shortenViaDub(env, longUrl);
    expect(result).toBe(longUrl);
  });
});

// ---------------------------------------------------------------------------
// processPostLinks — integration over pure + impure paths
// ---------------------------------------------------------------------------
describe('processPostLinks', () => {
  const noKeyEnv = { DUB_API_KEY: undefined } as unknown as Parameters<typeof processPostLinks>[0];

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('UTM-tags URLs in content and returns them when Dub is unconfigured', async () => {
    const result = await processPostLinks(noKeyEnv, {
      content: 'Visit https://shop.example.com/item',
      link: null,
      postId: 'p1',
      platform: 'twitter',
    });
    expect(result.content).toContain('utm_source=twitter');
    expect(result.content).toContain('utm_campaign=p1');
    expect(result.shortened).toBe(0);
  });

  it('replaces URLs in content with short links and counts them', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ shortLink: 'https://linkbl.ink/xyz' }), { status: 200 }),
    );
    const env = {
      DUB_API_KEY: 'k',
      DUB_API_BASE: 'https://app.claimyour.site/api',
      LINKBL_DOMAIN: 'linkbl.ink',
    } as unknown as typeof noKeyEnv;

    const result = await processPostLinks(env, {
      content: 'See https://example.com',
      link: null,
      postId: 'p2',
      platform: 'linkedin',
    });
    expect(result.content).toContain('linkbl.ink/xyz');
    expect(result.shortened).toBe(1);
  });

  it('also processes the link field independently of content', async () => {
    const result = await processPostLinks(noKeyEnv, {
      content: 'No URLs here',
      link: 'https://example.com/product',
      postId: 'p3',
      platform: 'facebook',
    });
    expect(result.link).toContain('utm_source=facebook');
    expect(result.shortened).toBe(0);
  });

  it('passes through null link unchanged', async () => {
    const result = await processPostLinks(noKeyEnv, {
      content: 'just text',
      link: null,
      postId: 'p4',
      platform: 'x',
    });
    expect(result.link).toBeNull();
  });
});
