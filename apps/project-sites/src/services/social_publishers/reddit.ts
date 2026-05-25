/**
 * Reddit — OAuth 2.0 + Submit endpoint.
 * Docs: https://www.reddit.com/dev/api/#POST_api_submit
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
import type { Env } from '../../types/env.js';

const SCOPES = 'identity submit read';
const UA_OVERRIDE = 'web:projectsites.dev:pulse-social:v1 (by /u/projectsites_bot)';

async function refreshIfExpired(env: Env, account: SocialAccountCtx): Promise<void> {
  if (account.token_expires_at && new Date(account.token_expires_at).getTime() > Date.now() + 60_000) return;
  if (!account.refresh_token) return;
  const creds = requireEnv(env, 'reddit', 'https://www.reddit.com/prefs/apps', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET');
  const basic = btoa(`${creds.REDDIT_CLIENT_ID}:${creds.REDDIT_CLIENT_SECRET}`);
  const res = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, 'User-Agent': UA_OVERRIDE, Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: account.refresh_token }).toString(),
  });
  if (!res.ok) throw new Error(`reddit_refresh_failed:${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  account.access_token = data.access_token;
  const exp = new Date(Date.now() + data.expires_in * 1000).toISOString();
  account.token_expires_at = exp;
  if (account.onTokenRefresh) await account.onTokenRefresh({ access_token: data.access_token, expires_at: exp });
}

export const reddit: Publisher = {
  authorizeUrl(env, { state, redirectUri }) {
    const clientId = (env as unknown as Record<string, string>).REDDIT_CLIENT_ID;
    if (!clientId) return null;
    return `https://www.reddit.com/api/v1/authorize?${new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      state,
      redirect_uri: redirectUri,
      duration: 'permanent',
      scope: SCOPES,
    }).toString()}`;
  },
  async exchangeCode(env, { code, redirectUri }) {
    const creds = requireEnv(env, 'reddit', 'https://www.reddit.com/prefs/apps', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET');
    const basic = btoa(`${creds.REDDIT_CLIENT_ID}:${creds.REDDIT_CLIENT_SECRET}`);
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'User-Agent': UA_OVERRIDE, Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
    });
    if (!res.ok) throw new Error(`reddit_exchange_failed:${res.status}`);
    const data = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string };
    const meRes = await fetch('https://oauth.reddit.com/api/v1/me', {
      headers: { ...BROWSER_HEADERS, 'User-Agent': UA_OVERRIDE, Authorization: `Bearer ${data.access_token}` },
    });
    const me = meRes.ok ? ((await meRes.json()) as { id?: string; name?: string }) : {};
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      external_id: me.id ?? null,
      handle: me.name ? `u/${me.name}` : null,
      display_name: me.name ?? null,
      scopes: data.scope ?? SCOPES,
    };
  },
  async publish(env, account, post): Promise<PublishResult> {
    await refreshIfExpired(env, account);
    const text = composeContent(post, 'reddit');
    // Subreddit comes from per_platform_overrides.reddit.subreddit (caller must provide one)
    const sr = (post.per_platform_overrides?.reddit as { subreddit?: string })?.subreddit ?? 'test';
    const title = text.split('\n')[0]?.slice(0, 300) ?? 'Post';
    const params = new URLSearchParams({
      sr,
      title,
      kind: post.link ? 'link' : 'self',
      api_type: 'json',
    });
    if (post.link) params.set('url', post.link);
    else params.set('text', text);
    const res = await fetch('https://oauth.reddit.com/api/submit', {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'User-Agent': UA_OVERRIDE,
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    if (!res.ok) throw new Error(`reddit_publish_failed:${res.status}`);
    const data = (await res.json()) as { json?: { data?: { url?: string; name?: string } } };
    const url = data.json?.data?.url ?? '';
    const id = data.json?.data?.name ?? '';
    return { external_id: id, external_url: url || `https://www.reddit.com/${id}` };
  },
  async fetchAnalytics(env, account, externalPostId): Promise<AnalyticsSnapshot> {
    await refreshIfExpired(env, account);
    const res = await fetch(`https://oauth.reddit.com/api/info?id=${externalPostId}`, {
      headers: { ...BROWSER_HEADERS, 'User-Agent': UA_OVERRIDE, Authorization: `Bearer ${account.access_token}` },
    });
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as {
      data?: { children?: Array<{ data?: { ups?: number; num_comments?: number; view_count?: number | null; score?: number } }> };
    };
    const post = data.data?.children?.[0]?.data ?? {};
    return {
      impressions: post.view_count ?? null,
      reach: null,
      likes: post.ups ?? null,
      comments: post.num_comments ?? null,
      shares: null,
      clicks: null,
      saves: null,
      raw: data,
    };
  },
};
