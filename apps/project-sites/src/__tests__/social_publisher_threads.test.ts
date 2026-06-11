/**
 * Integration-branch coverage for the Threads publisher
 * (`services/social_publishers/threads.ts`): 2-step container→publish, user-id
 * guard, container/publish error paths, insights mapping. fetch mocked.
 */
import { threads } from '../services/social_publishers/threads.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = {} as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1',
  org_id: 'o1',
  platform: 'threads',
  external_id: 'USER1',
  handle: '@bob',
  access_token: 'tok',
  refresh_token: null,
  token_expires_at: null,
  scopes: null,
  metadata: {},
  ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'Hello Threads',
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
  container?: () => Response;
  publish?: () => Response;
  insights?: () => Response;
}) {
  const fn = jest.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/insights')) return r.insights?.() ?? json({ data: [] });
    if (u.includes('/threads_publish')) return r.publish?.() ?? json({ id: 'T1' });
    if (u.includes('/threads')) return r.container?.() ?? json({ id: 'C1' });
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

describe('threads.publish', () => {
  it('runs container→publish and returns id + profile post URL', async () => {
    mockFetch({ container: () => json({ id: 'C1' }), publish: () => json({ id: 'T9' }) });
    expect(await threads.publish(ENV, account(), post())).toEqual({
      external_id: 'T9',
      external_url: 'https://www.threads.net/@bob/post/T9',
    });
  });
  it('throws without a user id', async () => {
    mockFetch({});
    await expect(threads.publish(ENV, account({ external_id: null }), post())).rejects.toThrow(
      /threads_user_id_missing/,
    );
  });
  it('throws when the container step is not OK', async () => {
    mockFetch({ container: () => new Response('no', { status: 400 }) });
    await expect(threads.publish(ENV, account(), post())).rejects.toThrow(
      /threads_container_failed:400/,
    );
  });
  it('throws when the publish step is not OK', async () => {
    mockFetch({
      container: () => json({ id: 'C1' }),
      publish: () => new Response('no', { status: 500 }),
    });
    await expect(threads.publish(ENV, account(), post())).rejects.toThrow(
      /threads_publish_failed:500/,
    );
  });
});

describe('threads.fetchAnalytics', () => {
  it('maps views/likes/replies and reposts+quotes→shares', async () => {
    mockFetch({
      insights: () =>
        json({
          data: [
            { name: 'views', values: [{ value: 300 }] },
            { name: 'likes', values: [{ value: 20 }] },
            { name: 'replies', values: [{ value: 5 }] },
            { name: 'reposts', values: [{ value: 2 }] },
            { name: 'quotes', values: [{ value: 1 }] },
          ],
        }),
    });
    const s = await threads.fetchAnalytics(ENV, account(), 'T9');
    expect(s.impressions).toBe(300);
    expect(s.likes).toBe(20);
    expect(s.comments).toBe(5);
    expect(s.shares).toBe(3);
  });
  it('returns an empty snapshot when insights is not OK', async () => {
    mockFetch({ insights: () => new Response('no', { status: 403 }) });
    expect((await threads.fetchAnalytics(ENV, account(), 'T9')).impressions).toBeNull();
  });
});
