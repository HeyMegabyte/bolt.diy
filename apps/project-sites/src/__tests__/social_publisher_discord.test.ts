/**
 * Integration-branch coverage for the Discord publisher
 * (`services/social_publishers/discord.ts`): bot-token + channel-id guards,
 * message POST (guild vs @me URL), error path, reactions analytics.
 */
import { discord } from '../services/social_publishers/discord.js';
import type { SocialAccountCtx, PostCtx } from '../services/social_publishers/types.js';
import type { Env } from '../types/env.js';

const ENV = { DISCORD_BOT_TOKEN: 'bot' } as unknown as Env;
const account = (over: Partial<SocialAccountCtx> = {}): SocialAccountCtx => ({
  id: 'a1',
  org_id: 'o1',
  platform: 'discord',
  external_id: null,
  handle: null,
  access_token: 'tok',
  refresh_token: null,
  token_expires_at: null,
  scopes: null,
  metadata: { channel_id: 'CHAN1' },
  ...over,
});
const post = (over: Partial<PostCtx> = {}): PostCtx => ({
  id: 'p1',
  content: 'Hi Discord',
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

describe('discord.publish', () => {
  it('posts a message and builds the guild channel URL', async () => {
    mock(() => json({ id: 'M1', channel_id: 'CHAN1', guild_id: 'G1' }));
    expect(await discord.publish(ENV, account(), post())).toEqual({
      external_id: 'M1',
      external_url: 'https://discord.com/channels/G1/CHAN1/M1',
    });
  });
  it('uses @me when there is no guild_id (DM)', async () => {
    mock(() => json({ id: 'M1', channel_id: 'CHAN1' }));
    expect((await discord.publish(ENV, account(), post())).external_url).toBe(
      'https://discord.com/channels/@me/CHAN1/M1',
    );
  });
  it('throws without a channel_id', async () => {
    mock(() => json({}));
    await expect(discord.publish(ENV, account({ metadata: {} }), post())).rejects.toThrow(
      /discord_channel_id_missing/,
    );
  });
  it('throws (MissingAppCreds) without the bot token', async () => {
    mock(() => json({}));
    await expect(discord.publish({} as unknown as Env, account(), post())).rejects.toThrow();
  });
  it('throws when the messages endpoint is not OK', async () => {
    mock(() => new Response('no', { status: 403 }));
    await expect(discord.publish(ENV, account(), post())).rejects.toThrow(
      /discord_publish_failed:403/,
    );
  });
});

describe('discord.fetchAnalytics', () => {
  it('sums reaction counts into likes', async () => {
    mock(() => json({ reactions: [{ count: 3 }, { count: 4 }] }));
    expect((await discord.fetchAnalytics(ENV, account(), 'M1')).likes).toBe(7);
  });
  it('returns an empty snapshot when the message fetch is not OK', async () => {
    mock(() => new Response('no', { status: 404 }));
    expect((await discord.fetchAnalytics(ENV, account(), 'M1')).likes).toBeNull();
  });
});
