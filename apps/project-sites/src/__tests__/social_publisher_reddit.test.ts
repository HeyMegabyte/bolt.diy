/**
 * Integration-branch coverage for the Reddit publisher
 * (`services/social_publishers/reddit.ts`): self vs link submit, subreddit from
 * per-platform override, token-refresh-on-expiry, submit error, info analytics.
 */
import { reddit } from '../services/social_publishers/reddit.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = { REDDIT_CLIENT_ID: 'cid', REDDIT_CLIENT_SECRET: 'sec' } as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1',
  org_id: 'o1',
  platform: 'reddit',
  external_id: 'u1',
  handle: 'u/bob',
  access_token: 'tok',
  refresh_token: null,
  token_expires_at: null,
  scopes: null,
  metadata: {},
  ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'My Title',
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
  token?: () => Response;
  submit?: (i?: RequestInit) => Response;
  info?: () => Response;
}) {
  const fn = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/access_token'))
      return r.token?.() ?? json({ access_token: 'a2', expires_in: 3600 });
    if (u.includes('/api/info')) return r.info?.() ?? json({ data: { children: [{ data: {} }] } });
    if (u.includes('/api/submit'))
      return (
        r.submit?.(init) ?? json({ json: { data: { name: 't3_x', url: 'https://reddit.com/x' } } })
      );
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

describe('reddit.publish', () => {
  it('submits a self-post and returns the name + url', async () => {
    const fn = mockFetch({
      submit: () =>
        json({ json: { data: { name: 't3_abc', url: 'https://reddit.com/r/test/abc' } } }),
    });
    const out = await reddit.publish(ENV, account(), post());
    expect(out).toEqual({ external_id: 't3_abc', external_url: 'https://reddit.com/r/test/abc' });
    const body = new URLSearchParams(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body.get('kind')).toBe('self');
    expect(body.get('text')).toContain('My Title');
  });
  it('submits a link-post when the post has a link', async () => {
    const fn = mockFetch({ submit: () => json({ json: { data: { name: 't3_1', url: 'u' } } }) });
    await reddit.publish(ENV, account(), post({ link: 'https://x.co/a' }));
    const body = new URLSearchParams(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body.get('kind')).toBe('link');
    expect(body.get('url')).toBe('https://x.co/a');
  });
  it('uses the subreddit from the per-platform override', async () => {
    const fn = mockFetch({ submit: () => json({ json: { data: { name: 't3_1', url: 'u' } } }) });
    await reddit.publish(
      ENV,
      account(),
      post({ per_platform_overrides: { reddit: { subreddit: 'programming' } as never } }),
    );
    expect(new URLSearchParams(String((fn.mock.calls[0][1] as RequestInit).body)).get('sr')).toBe(
      'programming',
    );
  });
  it('throws when submit is not OK', async () => {
    mockFetch({ submit: () => new Response('no', { status: 403 }) });
    await expect(reddit.publish(ENV, account(), post())).rejects.toThrow(
      /reddit_publish_failed:403/,
    );
  });
  it('refreshes an expired token before submitting', async () => {
    const fn = mockFetch({
      token: () => json({ access_token: 'fresh', expires_in: 3600 }),
      submit: () => json({ json: { data: { name: 't3_1', url: 'u' } } }),
    });
    const acc = account({
      refresh_token: 'ref',
      token_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await reddit.publish(ENV, acc, post());
    expect(acc.access_token).toBe('fresh');
    expect(String(fn.mock.calls[0][0])).toContain('/access_token');
  });
});

describe('reddit.fetchAnalytics', () => {
  it('maps ups/num_comments/view_count', async () => {
    mockFetch({
      info: () =>
        json({ data: { children: [{ data: { ups: 42, num_comments: 7, view_count: 999 } }] } }),
    });
    const s = await reddit.fetchAnalytics(ENV, account(), 't3_x');
    expect(s.likes).toBe(42);
    expect(s.comments).toBe(7);
    expect(s.impressions).toBe(999);
  });
  it('returns an empty snapshot when info is not OK', async () => {
    mockFetch({ info: () => new Response('no', { status: 401 }) });
    expect((await reddit.fetchAnalytics(ENV, account(), 't3_x')).likes).toBeNull();
  });
});
