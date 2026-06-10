/**
 * Integration-branch coverage for the Instagram publisher
 * (`services/social_publishers/instagram.ts`): two-step container→publish,
 * IG-business-account guard, requires-image guard, container/publish error
 * paths, permalink lookup, insights mapping. fetch mocked URL-aware.
 */
import { instagram } from '../services/social_publishers/instagram.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = {} as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1', org_id: 'o1', platform: 'instagram', external_id: 'IGACCT', handle: 'My IG',
  access_token: 'tok', refresh_token: null, token_expires_at: null, scopes: null, metadata: {}, ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1', content: 'Hello IG', per_platform_overrides: null,
  media_urls: [{ url: 'https://img/x.jpg', mime: 'image/jpeg', type: 'image' }],
  hashtags: [], mentions: [], link: null, ...over,
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
function mockFetch(r: { container?: () => Response; publish?: () => Response; permalink?: () => Response; insights?: () => Response }) {
  const fn = jest.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/insights')) return r.insights?.() ?? json({ data: [] });
    if (u.includes('/media_publish')) return r.publish?.() ?? json({ id: 'IGPOST' });
    if (u.includes('/media')) return r.container?.() ?? json({ id: 'CONTAINER' });
    if (u.includes('fields=permalink')) return r.permalink?.() ?? json({ permalink: 'https://instagram.com/p/abc/' });
    throw new Error(`unexpected fetch: ${u}`);
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });

describe('instagram.publish', () => {
  it('runs container→publish→permalink and returns id + permalink URL', async () => {
    mockFetch({
      container: () => json({ id: 'C1' }),
      publish: () => json({ id: 'IG1' }),
      permalink: () => json({ permalink: 'https://www.instagram.com/p/XYZ/' }),
    });
    expect(await instagram.publish(ENV, account(), post())).toEqual({
      external_id: 'IG1', external_url: 'https://www.instagram.com/p/XYZ/',
    });
  });
  it('falls back to a constructed URL when permalink lookup fails', async () => {
    mockFetch({
      container: () => json({ id: 'C1' }),
      publish: () => json({ id: 'IG1' }),
      permalink: () => new Response('no', { status: 400 }),
    });
    const out = await instagram.publish(ENV, account(), post());
    expect(out.external_url).toBe('https://www.instagram.com/p/IG1/');
  });
  it('throws without an IG business account', async () => {
    mockFetch({});
    await expect(instagram.publish(ENV, account({ external_id: null }), post())).rejects.toThrow(
      /instagram_business_account_missing/,
    );
  });
  it('throws when the post has no image', async () => {
    mockFetch({});
    await expect(instagram.publish(ENV, account(), post({ media_urls: [] }))).rejects.toThrow(
      /instagram_requires_image/,
    );
  });
  it('throws when the container step is not OK', async () => {
    mockFetch({ container: () => new Response('no', { status: 400 }) });
    await expect(instagram.publish(ENV, account(), post())).rejects.toThrow(/instagram_container_failed:400/);
  });
  it('throws when the media_publish step is not OK', async () => {
    mockFetch({ container: () => json({ id: 'C1' }), publish: () => new Response('no', { status: 500 }) });
    await expect(instagram.publish(ENV, account(), post())).rejects.toThrow(/instagram_publish_failed:500/);
  });
});

describe('instagram.fetchAnalytics', () => {
  it('maps the insights metrics into the snapshot', async () => {
    mockFetch({
      insights: () =>
        json({
          data: [
            { name: 'impressions', values: [{ value: 500 }] },
            { name: 'reach', values: [{ value: 400 }] },
            { name: 'likes', values: [{ value: 30 }] },
            { name: 'comments', values: [{ value: 6 }] },
            { name: 'saved', values: [{ value: 8 }] },
          ],
        }),
    });
    const s = await instagram.fetchAnalytics(ENV, account(), 'IG1');
    expect(s.impressions).toBe(500);
    expect(s.reach).toBe(400);
    expect(s.likes).toBe(30);
    expect(s.comments).toBe(6);
    expect(s.saves).toBe(8);
  });
  it('returns an empty snapshot when insights is not OK', async () => {
    mockFetch({ insights: () => new Response('no', { status: 403 }) });
    expect((await instagram.fetchAnalytics(ENV, account(), 'IG1')).impressions).toBeNull();
  });
});
