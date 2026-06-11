/**
 * Integration-branch coverage for the Bluesky publisher
 * (`services/social_publishers/bluesky.ts`) — AT Protocol: createRecord post,
 * link-facet, JWT refresh-on-expiry, getPostThread analytics, and the exported
 * blueskyLogin (createSession) helper. fetch mocked URL-aware.
 */
import { bluesky, blueskyLogin } from '../services/social_publishers/bluesky.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = {} as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1',
  org_id: 'o1',
  platform: 'bluesky',
  external_id: 'did:plc:xyz',
  handle: '@bob.bsky',
  access_token: 'jwt',
  refresh_token: null,
  token_expires_at: null,
  scopes: null,
  metadata: {},
  ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'Hello bsky',
  per_platform_overrides: null,
  media_urls: [],
  hashtags: [],
  mentions: [],
  link: null,
  ...over,
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
function mockFetch(r: {
  create?: (i?: RequestInit) => Response;
  thread?: () => Response;
  refresh?: () => Response;
  session?: () => Response;
}) {
  const fn = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('refreshSession'))
      return r.refresh?.() ?? json({ accessJwt: 'a2', refreshJwt: 'r2' });
    if (u.includes('createSession'))
      return r.session?.() ?? json({ accessJwt: 'a', refreshJwt: 'r', did: 'd', handle: 'h' });
    if (u.includes('getPostThread')) return r.thread?.() ?? json({ thread: { post: {} } });
    if (u.includes('createRecord'))
      return r.create?.(init) ?? json({ uri: 'at://x/app.bsky.feed.post/k1', cid: 'c' });
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

describe('bluesky.publish', () => {
  it('creates a record and returns uri + bsky.app post URL', async () => {
    mockFetch({ create: () => json({ uri: 'at://did:plc:xyz/app.bsky.feed.post/abc', cid: 'c' }) });
    expect(await bluesky.publish(ENV, account(), post())).toEqual({
      external_id: 'at://did:plc:xyz/app.bsky.feed.post/abc',
      external_url: 'https://bsky.app/profile/bob.bsky/post/abc',
    });
  });
  it('adds a link facet when the post has a link', async () => {
    const fn = mockFetch({ create: () => json({ uri: 'at://x/app.bsky.feed.post/k', cid: 'c' }) });
    await bluesky.publish(
      ENV,
      account(),
      post({ content: 'see https://x.co/a', link: 'https://x.co/a' }),
    );
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body)) as {
      record: { facets?: unknown[] };
    };
    expect(Array.isArray(body.record.facets)).toBe(true);
  });
  it('throws when createRecord is not OK', async () => {
    mockFetch({ create: () => new Response('no', { status: 400 }) });
    await expect(bluesky.publish(ENV, account(), post())).rejects.toThrow(
      /bluesky_publish_failed:400/,
    );
  });
  it('refreshes an expired JWT before posting and fires onTokenRefresh', async () => {
    const onTokenRefresh = jest.fn().mockResolvedValue(undefined);
    const fn = mockFetch({
      refresh: () => json({ accessJwt: 'fresh', refreshJwt: 'ref2' }),
      create: () => json({ uri: 'at://x/app.bsky.feed.post/k', cid: 'c' }),
    });
    const acc = account({ refresh_token: 'oldref', token_expires_at: null, onTokenRefresh });
    await bluesky.publish(ENV, acc, post());
    expect(acc.access_token).toBe('fresh');
    expect(onTokenRefresh).toHaveBeenCalledTimes(1);
    expect(String(fn.mock.calls[0][0])).toContain('refreshSession');
  });
});

describe('bluesky.fetchAnalytics', () => {
  it('maps like/reply counts and reposts+quotes→shares', async () => {
    mockFetch({
      thread: () =>
        json({ thread: { post: { likeCount: 9, replyCount: 3, repostCount: 2, quoteCount: 1 } } }),
    });
    const s = await bluesky.fetchAnalytics(ENV, account(), 'at://x/app.bsky.feed.post/k');
    expect(s.likes).toBe(9);
    expect(s.comments).toBe(3);
    expect(s.shares).toBe(3);
  });
  it('returns an empty snapshot when getPostThread is not OK', async () => {
    mockFetch({ thread: () => new Response('no', { status: 401 }) });
    expect((await bluesky.fetchAnalytics(ENV, account(), 'at://x')).likes).toBeNull();
  });
});

describe('blueskyLogin', () => {
  it('returns tokens + did + handle from a successful createSession', async () => {
    mockFetch({
      session: () =>
        json({ accessJwt: 'A', refreshJwt: 'R', did: 'did:plc:1', handle: 'bob.bsky' }),
    });
    const out = await blueskyLogin('bob.bsky', 'app-pass');
    expect(out.access_token).toBe('A');
    expect(out.refresh_token).toBe('R');
    expect(out.external_id).toBe('did:plc:1');
    expect(out.handle).toBe('bob.bsky');
  });
  it('throws on a failed login', async () => {
    mockFetch({ session: () => new Response('bad', { status: 401 }) });
    await expect(blueskyLogin('bob', 'wrong')).rejects.toThrow(/bluesky_login_failed:401/);
  });
});
