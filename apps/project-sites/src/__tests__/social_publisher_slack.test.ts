/**
 * Integration-branch coverage for the Slack publisher
 * (`services/social_publishers/slack.ts`): channel-id guard, chat.postMessage
 * (http-!ok AND data.ok=false error paths), permalink/fallback URL, reactions
 * + reply_count analytics, bad-post-id + !ok analytics.
 */
import { slack } from '../services/social_publishers/slack.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = {} as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1',
  org_id: 'o1',
  platform: 'slack',
  external_id: 'T1',
  handle: 'Team',
  access_token: 'tok',
  refresh_token: null,
  token_expires_at: null,
  scopes: null,
  metadata: { channel_id: 'C1', team_id: 'T1' },
  ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'Hi Slack',
  per_platform_overrides: null,
  media_urls: [],
  hashtags: [],
  mentions: [],
  link: null,
  ...over,
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const mock = (h: () => Response) => {
  const fn = jest.fn(async () => h());
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('slack.publish', () => {
  it('posts a message and returns channel:ts + permalink', async () => {
    mock(() => json({ ok: true, ts: '1.2', channel: 'C1', permalink: 'https://slack.com/p/1' }));
    expect(await slack.publish(ENV, account(), post())).toEqual({
      external_id: 'C1:1.2',
      external_url: 'https://slack.com/p/1',
    });
  });
  it('falls back to a client URL when no permalink', async () => {
    mock(() => json({ ok: true, ts: '1.2', channel: 'C1' }));
    expect((await slack.publish(ENV, account(), post())).external_url).toBe(
      'https://app.slack.com/client/T1/C1',
    );
  });
  it('throws when Slack returns ok:false', async () => {
    mock(() => json({ ok: false, error: 'channel_not_found' }));
    await expect(slack.publish(ENV, account(), post())).rejects.toThrow(
      /slack_publish_err:channel_not_found/,
    );
  });
  it('throws when the HTTP call is not OK', async () => {
    mock(() => new Response('no', { status: 500 }));
    await expect(slack.publish(ENV, account(), post())).rejects.toThrow(/slack_publish_failed:500/);
  });
  it('throws without a channel id', async () => {
    mock(() => json({}));
    await expect(
      slack.publish(ENV, account({ metadata: {}, external_id: null }), post()),
    ).rejects.toThrow(/slack_channel_id_missing/);
  });
});

describe('slack.fetchAnalytics', () => {
  it('sums reactions into likes and maps reply_count', async () => {
    mock(() => json({ message: { reactions: [{ count: 2 }, { count: 5 }], reply_count: 3 } }));
    const s = await slack.fetchAnalytics(ENV, account(), 'C1:1.2');
    expect(s.likes).toBe(7);
    expect(s.comments).toBe(3);
  });
  it('returns empty (bad_post_id) when the post id is malformed', async () => {
    const fn = mock(() => json({}));
    const s = await slack.fetchAnalytics(ENV, account(), 'no-colon');
    expect(s.likes).toBeNull();
    expect(fn).not.toHaveBeenCalled(); // short-circuits before the API call
  });
  it('returns an empty snapshot when reactions.get is not OK', async () => {
    mock(() => new Response('no', { status: 403 }));
    expect((await slack.fetchAnalytics(ENV, account(), 'C1:1.2')).likes).toBeNull();
  });
});
