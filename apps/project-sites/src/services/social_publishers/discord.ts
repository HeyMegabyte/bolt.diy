/**
 * Discord — webhooks/bot. We use a bot token + channel ID (stored in
 * metadata.channel_id) to POST messages.
 * Docs: https://discord.com/developers/docs/resources/channel#create-message
 */
import {
  BROWSER_HEADERS,
  composeContent,
  emptyAnalytics,
  requireEnv,
  type AnalyticsSnapshot,
  type Publisher,
  type PublishResult,
  type SocialAccountCtx,
} from './types.js';

function channelId(account: SocialAccountCtx): string {
  const c = account.metadata?.channel_id as string | undefined;
  if (!c) throw new Error('discord_channel_id_missing');
  return c;
}

export const discord: Publisher = {
  // Bot token = server-wide; no OAuth dance needed for Pulse use case.
  async publish(env, account, post): Promise<PublishResult> {
    const creds = requireEnv(env, 'discord', 'https://discord.com/developers/applications', 'DISCORD_BOT_TOKEN');
    const text = composeContent(post, 'discord').slice(0, 2000);
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId(account)}/messages`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, Authorization: `Bot ${creds.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    if (!res.ok) throw new Error(`discord_publish_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { id: string; channel_id: string; guild_id?: string };
    const guildPart = data.guild_id ?? '@me';
    return { external_id: data.id, external_url: `https://discord.com/channels/${guildPart}/${data.channel_id}/${data.id}` };
  },
  async fetchAnalytics(env, account, externalPostId): Promise<AnalyticsSnapshot> {
    const creds = requireEnv(env, 'discord', 'https://discord.com/developers/applications', 'DISCORD_BOT_TOKEN');
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId(account)}/messages/${externalPostId}`,
      { headers: { ...BROWSER_HEADERS, Authorization: `Bot ${creds.DISCORD_BOT_TOKEN}` } },
    );
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as { reactions?: Array<{ count?: number }> };
    const likes = (data.reactions ?? []).reduce((a, r) => a + (r.count ?? 0), 0) || null;
    return { impressions: null, reach: null, likes, comments: null, shares: null, clicks: null, saves: null, raw: data };
  },
};
