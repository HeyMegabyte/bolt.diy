/**
 * Unit tests for the social link shortener ({@link services/link_shortener}).
 *
 * Pure helpers (addUtm / extractUrls) are tested directly. The Dub call +
 * processPostLinks are tested with a stubbed global.fetch — proving the
 * fail-soft contract (no key / non-2xx / network throw → original URL kept) and
 * the happy path (Dub returns a linkbl.ink short link).
 */
import type { Env } from '../types/env.js';
import {
  addUtm,
  extractUrls,
  shortenViaDub,
  processPostLinks,
} from '../services/link_shortener.js';

const UTM = { source: 'facebook', medium: 'social', campaign: 'p1' };

describe('addUtm', () => {
  it('appends utm params to a clean URL', () => {
    expect(addUtm('https://shop.example.com/x', UTM)).toBe(
      'https://shop.example.com/x?utm_source=facebook&utm_medium=social&utm_campaign=p1',
    );
  });

  it('preserves existing query params', () => {
    expect(addUtm('https://e.com/?a=1', UTM)).toContain('a=1');
  });

  it('never clobbers a pre-existing utm_* key', () => {
    const out = addUtm('https://e.com/?utm_source=manual', UTM);
    expect(out).toContain('utm_source=manual');
    expect(out).not.toContain('utm_source=facebook');
    expect(out).toContain('utm_medium=social');
  });

  it('leaves non-http(s) / non-URL strings unchanged', () => {
    expect(addUtm('mailto:a@b.com', UTM)).toBe('mailto:a@b.com');
    expect(addUtm('not a url', UTM)).toBe('not a url');
  });
});

describe('extractUrls', () => {
  it('finds distinct URLs and strips trailing punctuation', () => {
    const urls = extractUrls('See https://a.com/x, and https://a.com/x again, plus https://b.com.');
    expect(urls).toEqual(['https://a.com/x', 'https://b.com']);
  });

  it('returns [] when there are no URLs', () => {
    expect(extractUrls('just text, no links')).toEqual([]);
  });
});

function fetchOnce(impl: (url: string, init: RequestInit) => unknown): jest.Mock {
  const spy = jest.fn(async (url: string, init: RequestInit) => impl(url, init));
  (global as unknown as { fetch: unknown }).fetch = spy;
  return spy as unknown as jest.Mock;
}

const okDub = (shortLink: string) =>
  fetchOnce(() => ({ ok: true, status: 200, json: async () => ({ shortLink }) }));

afterEach(() => jest.restoreAllMocks());

describe('shortenViaDub — fail-soft', () => {
  it('returns the long URL unchanged when DUB_API_KEY is unset (no fetch)', async () => {
    const spy = fetchOnce(() => ({ ok: true, status: 200, json: async () => ({}) }));
    const env = {} as Env;
    expect(await shortenViaDub(env, 'https://e.com/x')).toBe('https://e.com/x');
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns the short link on a 2xx from Dub', async () => {
    okDub('https://linkbl.ink/abc');
    const env = { DUB_API_KEY: 'dub_x' } as Env;
    expect(await shortenViaDub(env, 'https://e.com/x')).toBe('https://linkbl.ink/abc');
  });

  it('falls back to the long URL on a non-2xx', async () => {
    fetchOnce(() => ({ ok: false, status: 500, json: async () => ({}) }));
    const env = { DUB_API_KEY: 'dub_x' } as Env;
    expect(await shortenViaDub(env, 'https://e.com/x')).toBe('https://e.com/x');
  });

  it('falls back to the long URL on a network throw', async () => {
    fetchOnce(() => {
      throw new Error('network down');
    });
    const env = { DUB_API_KEY: 'dub_x' } as Env;
    expect(await shortenViaDub(env, 'https://e.com/x')).toBe('https://e.com/x');
  });

  it('targets linkbl.ink + the configured base with a bearer key', async () => {
    const spy = okDub('https://linkbl.ink/z');
    const env = { DUB_API_KEY: 'dub_x' } as Env;
    await shortenViaDub(env, 'https://e.com/x');
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.claimyour.site/api/links');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dub_x');
    expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://e.com/x', domain: 'linkbl.ink' });
  });
});

describe('processPostLinks', () => {
  it('UTM-tags + shortens every URL in content and the link field', async () => {
    // Dub echoes a deterministic short link per call.
    let n = 0;
    fetchOnce(() => ({ ok: true, status: 200, json: async () => ({ shortLink: `https://linkbl.ink/${++n}` }) }));
    const env = { DUB_API_KEY: 'dub_x' } as Env;
    const res = await processPostLinks(env, {
      content: 'Check https://shop.com/sale now',
      link: 'https://shop.com/book',
      postId: 'p1',
      platform: 'facebook',
    });
    expect(res.content).toContain('https://linkbl.ink/');
    expect(res.content).not.toContain('https://shop.com/sale');
    expect(res.link).toMatch(/^https:\/\/linkbl\.ink\//);
    expect(res.shortened).toBe(2);
  });

  it('is fully fail-soft with no key — content unchanged, but UTM-tagged', async () => {
    const env = {} as Env;
    const res = await processPostLinks(env, {
      content: 'Visit https://shop.com/x',
      link: null,
      postId: 'p1',
      platform: 'instagram',
    });
    expect(res.shortened).toBe(0);
    expect(res.content).toContain('utm_source=instagram');
    expect(res.content).toContain('utm_campaign=p1');
  });

  it('handles a post with no links cleanly', async () => {
    const env = {} as Env;
    const res = await processPostLinks(env, {
      content: 'No links here',
      link: null,
      postId: 'p1',
      platform: 'social',
    });
    expect(res).toEqual({ content: 'No links here', link: null, shortened: 0 });
  });
});
