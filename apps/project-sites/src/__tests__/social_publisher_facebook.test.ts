/**
 * Integration-branch coverage for the Facebook Pages publisher
 * (`services/social_publishers/facebook.ts`): page-feed POST, page-id guard,
 * link attach, Graph insights mapping (reactions summed → likes). fetch mocked.
 */
import { facebook } from '../services/social_publishers/facebook.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = {} as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1',
  org_id: 'o1',
  platform: 'facebook',
  external_id: 'PAGE1',
  handle: 'My Page',
  access_token: 'tok',
  refresh_token: null,
  token_expires_at: null,
  scopes: null,
  metadata: {},
  ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'Hello FB',
  per_platform_overrides: null,
  media_urls: [],
  hashtags: [],
  mentions: [],
  link: null,
  ...over,
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
function mockFetch(routes: { feed?: (i?: RequestInit) => Response; insights?: () => Response }) {
  const fn = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/insights')) return routes.insights?.() ?? json({ data: [] });
    if (u.includes('/feed')) return routes.feed?.(init) ?? json({ id: 'POST1' });
    throw new Error(`unexpected fetch: ${u}`);
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('facebook.publish', () => {
  it('posts to the page feed and returns id + url', async () => {
    mockFetch({ feed: () => json({ id: '987' }) });
    expect(await facebook.publish(ENV, account(), post())).toEqual({
      external_id: '987',
      external_url: 'https://www.facebook.com/987',
    });
  });
  it('attaches a link when the post has one', async () => {
    const fn = mockFetch({ feed: () => json({ id: '1' }) });
    await facebook.publish(ENV, account(), post({ link: 'https://x.co/a' }));
    const body = new URLSearchParams(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body.get('message')).toBe('Hello FB\nhttps://x.co/a');
    expect(body.get('link')).toBe('https://x.co/a');
  });
  it('throws without a page id', async () => {
    mockFetch({});
    await expect(facebook.publish(ENV, account({ external_id: null }), post())).rejects.toThrow(
      /facebook_page_id_missing/,
    );
  });
  it('throws when the feed endpoint is not OK', async () => {
    mockFetch({ feed: () => new Response('no', { status: 400 }) });
    await expect(facebook.publish(ENV, account(), post())).rejects.toThrow(
      /facebook_publish_failed:400/,
    );
  });
});

describe('facebook.fetchAnalytics', () => {
  it('maps impressions/reach/clicks and sums reactions into likes', async () => {
    mockFetch({
      insights: () =>
        json({
          data: [
            { name: 'post_impressions', values: [{ value: 200 }] },
            { name: 'post_impressions_unique', values: [{ value: 150 }] },
            { name: 'post_clicks', values: [{ value: 9 }] },
            { name: 'post_reactions_by_type_total', values: [{ value: { like: 10, love: 5 } }] },
          ],
        }),
    });
    const s = await facebook.fetchAnalytics(ENV, account(), 'POST1');
    expect(s.impressions).toBe(200);
    expect(s.reach).toBe(150);
    expect(s.clicks).toBe(9);
    expect(s.likes).toBe(15);
  });
  it('returns an empty snapshot when insights is not OK', async () => {
    mockFetch({ insights: () => new Response('no', { status: 403 }) });
    const s = await facebook.fetchAnalytics(ENV, account(), 'POST1');
    expect(s.impressions).toBeNull();
    expect(s.likes).toBeNull();
  });
});
