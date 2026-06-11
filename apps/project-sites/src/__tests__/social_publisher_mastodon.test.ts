/**
 * Integration-branch coverage for the Mastodon publisher
 * (`services/social_publishers/mastodon.ts`): instance-URL resolution
 * (metadata + default + trailing-slash strip), statuses POST, error path,
 * status analytics, and the exported mastodonVerify helper. fetch mocked.
 */
import { mastodon, mastodonVerify } from '../services/social_publishers/mastodon.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = {} as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1', org_id: 'o1', platform: 'mastodon', external_id: 'm1', handle: '@bob',
  access_token: 'tok', refresh_token: null, token_expires_at: null, scopes: null,
  metadata: { instance_url: 'https://m.test' }, ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1', content: 'Hello Masto', per_platform_overrides: null, media_urls: [], hashtags: [],
  mentions: [], link: null, ...over,
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
function mockFetch(handler: (u: string) => Response) {
  const fn = jest.fn(async (url: string | URL) => handler(String(url)));
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; jest.clearAllMocks(); });

describe('mastodon.publish', () => {
  it('posts a status to the account instance and returns id + url', async () => {
    mockFetch(() => json({ id: 'S1', url: 'https://m.test/@bob/S1' }));
    expect(await mastodon.publish(ENV, account(), post())).toEqual({
      external_id: 'S1', external_url: 'https://m.test/@bob/S1',
    });
  });
  it('falls back to mastodon.social when no instance_url in metadata', async () => {
    const fn = mockFetch(() => json({ id: 'S1', url: 'u' }));
    await mastodon.publish(ENV, account({ metadata: {} }), post());
    expect(String(fn.mock.calls[0][0])).toBe('https://mastodon.social/api/v1/statuses');
  });
  it('strips a trailing slash on the instance URL', async () => {
    const fn = mockFetch(() => json({ id: 'S1', url: 'u' }));
    await mastodon.publish(ENV, account({ metadata: { instance_url: 'https://m.test/' } }), post());
    expect(String(fn.mock.calls[0][0])).toBe('https://m.test/api/v1/statuses');
  });
  it('throws when the statuses endpoint is not OK', async () => {
    mockFetch(() => new Response('no', { status: 422 }));
    await expect(mastodon.publish(ENV, account(), post())).rejects.toThrow(/mastodon_publish_failed:422/);
  });
});

describe('mastodon.fetchAnalytics', () => {
  it('maps favourites/replies/reblogs', async () => {
    mockFetch(() => json({ favourites_count: 11, replies_count: 4, reblogs_count: 3 }));
    const s = await mastodon.fetchAnalytics(ENV, account(), 'S1');
    expect(s.likes).toBe(11);
    expect(s.comments).toBe(4);
    expect(s.shares).toBe(3);
  });
  it('returns an empty snapshot when the status fetch is not OK', async () => {
    mockFetch(() => new Response('no', { status: 404 }));
    expect((await mastodon.fetchAnalytics(ENV, account(), 'S1')).likes).toBeNull();
  });
});

describe('mastodonVerify', () => {
  it('returns account details from verify_credentials', async () => {
    mockFetch(() => json({ id: 'm9', username: 'bob', display_name: 'Bob', avatar: 'https://a/x.png' }));
    const out = await mastodonVerify('https://m.test/', 'tok');
    expect(out).toEqual({
      external_id: 'm9', handle: '@bob', display_name: 'Bob', avatar_url: 'https://a/x.png',
    });
  });
  it('throws on a failed verification', async () => {
    mockFetch(() => new Response('no', { status: 401 }));
    await expect(mastodonVerify('https://m.test', 'bad')).rejects.toThrow(/mastodon_verify_failed:401/);
  });
});
