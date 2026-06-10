/**
 * Integration-branch coverage for the Twitter/X publisher
 * (`services/social_publishers/twitter.ts`) — representative of the OAuth
 * publisher pattern (token-refresh-on-expiry, compose+truncate, POST,
 * !ok→throw, analytics mapping). `fetch` is mocked URL-aware; no network.
 *
 * Establishes the reusable shape for covering the other 10 publishers.
 */
import { twitter } from '../services/social_publishers/twitter.js';
import type {
  SocialAccountCtx,
  PostCtx,
} from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = { TWITTER_CLIENT_ID: 'cid', TWITTER_CLIENT_SECRET: 'sec' } as unknown as Env;

const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1',
  org_id: 'o1',
  platform: 'twitter',
  external_id: 'x1',
  handle: '@bob',
  access_token: 'tok',
  refresh_token: 'ref',
  token_expires_at: null, // null → refreshIfExpired short-circuits
  scopes: null,
  metadata: {},
  ...over,
});

const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'Hello world',
  per_platform_overrides: null,
  media_urls: [],
  hashtags: [],
  mentions: [],
  link: null,
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Routes {
  token?: () => Response;
  publish?: (init?: RequestInit) => Response;
  analytics?: () => Response;
}
function mockFetch(routes: Routes) {
  const fn = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/oauth2/token')) return routes.token?.() ?? json({ access_token: 'new' });
    if (u.includes('/2/tweets/')) return routes.analytics?.() ?? json({}); // GET w/ id
    if (u.includes('/2/tweets')) return routes.publish?.(init) ?? json({ data: { id: '1' } });
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

describe('twitter.publish', () => {
  it('posts the composed text and returns id + status URL with bare handle', async () => {
    mockFetch({ publish: () => json({ data: { id: '123', text: 'Hello world' } }) });
    const out = await twitter.publish(ENV, account(), post());
    expect(out).toEqual({
      external_id: '123',
      external_url: 'https://x.com/bob/status/123',
    });
  });

  it('truncates content to 280 chars before posting', async () => {
    const fn = mockFetch({ publish: () => json({ data: { id: '1' } }) });
    await twitter.publish(ENV, account(), post({ content: 'a'.repeat(400) }));
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body)) as { text: string };
    expect(body.text.length).toBe(280);
  });

  it('throws when the tweets endpoint is not OK', async () => {
    mockFetch({ publish: () => new Response('bad', { status: 401 }) });
    await expect(twitter.publish(ENV, account(), post())).rejects.toThrow(/twitter_publish_failed:401/);
  });
});

describe('twitter token refresh (publish path)', () => {
  it('refreshes an expired token, updates the account, and fires onTokenRefresh', async () => {
    const fn = mockFetch({
      token: () => json({ access_token: 'fresh', refresh_token: 'ref2', expires_in: 7200 }),
      publish: () => json({ data: { id: '9' } }),
    });
    const onTokenRefresh = jest.fn().mockResolvedValue(undefined);
    const acc = account({
      token_expires_at: new Date(Date.now() - 60_000).toISOString(), // expired
      onTokenRefresh,
    });
    await twitter.publish(ENV, acc, post());
    expect(acc.access_token).toBe('fresh');
    expect(acc.refresh_token).toBe('ref2');
    expect(onTokenRefresh).toHaveBeenCalledTimes(1);
    // token endpoint hit before the tweets endpoint
    expect(String(fn.mock.calls[0][0])).toContain('/oauth2/token');
  });

  it('throws when the token is expired but there is no refresh_token', async () => {
    mockFetch({});
    const acc = account({
      token_expires_at: new Date(Date.now() - 60_000).toISOString(),
      refresh_token: null,
    });
    await expect(twitter.publish(ENV, acc, post())).rejects.toThrow(/twitter_refresh_token_missing/);
  });
});

describe('twitter.fetchAnalytics', () => {
  it('maps public_metrics into the analytics snapshot', async () => {
    mockFetch({
      analytics: () =>
        json({
          data: {
            public_metrics: {
              like_count: 5,
              reply_count: 2,
              retweet_count: 1,
              quote_count: 1,
              impression_count: 100,
              bookmark_count: 3,
            },
          },
        }),
    });
    const snap = await twitter.fetchAnalytics(ENV, account(), '123');
    expect(snap.likes).toBe(5);
    expect(snap.comments).toBe(2);
    expect(snap.shares).toBe(2); // retweet + quote
    expect(snap.impressions).toBe(100);
    expect(snap.saves).toBe(3);
  });

  it('returns an empty snapshot when the metrics endpoint is not OK', async () => {
    mockFetch({ analytics: () => new Response('no', { status: 403 }) });
    const snap = await twitter.fetchAnalytics(ENV, account(), '123');
    expect(snap.impressions).toBeNull();
    expect(snap.likes).toBeNull();
  });
});
