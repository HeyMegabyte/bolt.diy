/**
 * Slack — Web API. OAuth v2 workspace install. Channel ID stored in metadata.
 * Docs: https://api.slack.com/methods/chat.postMessage
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

const SCOPES = 'chat:write,channels:read,channels:join';

function channelId(account: SocialAccountCtx): string {
  const c = (account.metadata?.channel_id as string | undefined) ?? account.external_id;
  if (!c) throw new Error('slack_channel_id_missing');
  return c;
}

export const slack: Publisher = {
  authorizeUrl(env, { state, redirectUri }) {
    const clientId = (env as unknown as Record<string, string>).SLACK_CLIENT_ID;
    if (!clientId) return null;
    return `https://slack.com/oauth/v2/authorize?${new URLSearchParams({
      client_id: clientId,
      scope: SCOPES,
      redirect_uri: redirectUri,
      state,
    }).toString()}`;
  },
  async exchangeCode(env, { code, redirectUri }) {
    const creds = requireEnv(env, 'slack', 'https://api.slack.com/apps', 'SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET');
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.SLACK_CLIENT_ID,
        client_secret: creds.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!res.ok) throw new Error(`slack_exchange_failed:${res.status}`);
    const data = (await res.json()) as {
      ok: boolean;
      access_token: string;
      team?: { id: string; name: string };
      authed_user?: { id: string };
      error?: string;
    };
    if (!data.ok) throw new Error(`slack_exchange_err:${data.error}`);
    return {
      access_token: data.access_token,
      external_id: data.team?.id ?? null,
      handle: data.team?.name ?? null,
      display_name: data.team?.name ?? null,
      scopes: SCOPES,
      metadata: { team_id: data.team?.id, user_id: data.authed_user?.id },
    };
  },
  async publish(_env, account, post): Promise<PublishResult> {
    const text = composeContent(post, 'slack');
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.access_token}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: channelId(account), text, unfurl_links: true }),
    });
    if (!res.ok) throw new Error(`slack_publish_failed:${res.status}`);
    const data = (await res.json()) as { ok: boolean; ts?: string; channel?: string; permalink?: string; error?: string };
    if (!data.ok) throw new Error(`slack_publish_err:${data.error}`);
    const teamId = (account.metadata?.team_id as string | undefined) ?? account.external_id ?? '';
    return {
      external_id: `${data.channel}:${data.ts}`,
      external_url: data.permalink ?? `https://app.slack.com/client/${teamId}/${data.channel}`,
    };
  },
  async fetchAnalytics(_env, account, externalPostId): Promise<AnalyticsSnapshot> {
    const [channel, ts] = externalPostId.split(':');
    if (!channel || !ts) return emptyAnalytics({ reason: 'bad_post_id' });
    const res = await fetch(
      `https://slack.com/api/reactions.get?channel=${channel}&timestamp=${ts}`,
      { headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.access_token}` } },
    );
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as { message?: { reactions?: Array<{ count?: number }>; reply_count?: number } };
    const likes = (data.message?.reactions ?? []).reduce((a, r) => a + (r.count ?? 0), 0) || null;
    return {
      impressions: null,
      reach: null,
      likes,
      comments: data.message?.reply_count ?? null,
      shares: null,
      clicks: null,
      saves: null,
      raw: data,
    };
  },
};
