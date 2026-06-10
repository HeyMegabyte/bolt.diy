/**
 * Integration-branch coverage for the LinkedIn publisher
 * (`services/social_publishers/linkedin.ts`). Differs from twitter: no token
 * refresh, requires `account.external_id` (author urn), UGC ShareContent body,
 * socialActions analytics. `fetch` mocked URL-aware; no network.
 */
import { linkedin } from '../services/social_publishers/linkedin.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = {} as unknown as Env;

const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1',
  org_id: 'o1',
  platform: 'linkedin',
  external_id: 'PERSON123',
  handle: null,
  access_token: 'tok',
  refresh_token: null,
  token_expires_at: null,
  scopes: null,
  metadata: {},
  ...over,
});

const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'Hello LinkedIn',
  per_platform_overrides: null,
  media_urls: [],
  hashtags: [],
  mentions: [],
  link: null,
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockFetch(routes: { publish?: (init?: RequestInit) => Response; analytics?: () => Response }) {
  const fn = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/v2/socialActions/')) return routes.analytics?.() ?? json({});
    if (u.includes('/v2/ugcPosts')) return routes.publish?.(init) ?? json({ id: 'urn:li:share:1' });
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

describe('linkedin.publish', () => {
  it('posts a UGC share and returns the id + feed URL', async () => {
    mockFetch({ publish: () => json({ id: 'urn:li:share:789' }) });
    const out = await linkedin.publish(ENV, account(), post());
    expect(out).toEqual({
      external_id: 'urn:li:share:789',
      external_url: 'https://www.linkedin.com/feed/update/urn:li:share:789/',
    });
  });

  it('sends the composed text as shareCommentary under the author urn', async () => {
    const fn = mockFetch({ publish: () => json({ id: 'urn:li:share:1' }) });
    await linkedin.publish(ENV, account({ external_id: 'P9' }), post({ content: 'Body text' }));
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body)) as {
      author: string;
      specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: string } } };
    };
    expect(body.author).toBe('urn:li:person:P9');
    expect(body.specificContent['com.linkedin.ugc.ShareContent'].shareCommentary.text).toBe('Body text');
  });

  it('throws when the account has no external_id (author urn)', async () => {
    mockFetch({});
    await expect(linkedin.publish(ENV, account({ external_id: null }), post())).rejects.toThrow(
      /linkedin_external_id_missing/,
    );
  });

  it('throws when the ugcPosts endpoint is not OK', async () => {
    mockFetch({ publish: () => new Response('bad', { status: 422 }) });
    await expect(linkedin.publish(ENV, account(), post())).rejects.toThrow(/linkedin_publish_failed:422/);
  });
});

describe('linkedin.fetchAnalytics', () => {
  it('maps likesSummary + commentsSummary into the snapshot', async () => {
    mockFetch({
      analytics: () =>
        json({ likesSummary: { totalLikes: 12 }, commentsSummary: { totalFirstLevelComments: 4 } }),
    });
    const snap = await linkedin.fetchAnalytics(ENV, account(), 'urn:li:share:1');
    expect(snap.likes).toBe(12);
    expect(snap.comments).toBe(4);
    expect(snap.impressions).toBeNull(); // LinkedIn basic API exposes no impressions
  });

  it('returns an empty snapshot when socialActions is not OK', async () => {
    mockFetch({ analytics: () => new Response('no', { status: 403 }) });
    const snap = await linkedin.fetchAnalytics(ENV, account(), 'urn:li:share:1');
    expect(snap.likes).toBeNull();
    expect(snap.comments).toBeNull();
  });
});
