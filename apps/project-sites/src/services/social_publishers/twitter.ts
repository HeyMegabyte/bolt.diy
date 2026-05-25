/**
 * Twitter / X — API v2 OAuth 2.0 PKCE + tweet endpoint.
 * Docs: https://docs.x.com/x-api/posts/creation-of-a-post
 */
import type { Env } from '../../types/env.js';
import {
  BROWSER_HEADERS,
  composeContent,
  emptyAnalytics,
  MissingAppCredsError,
  requireEnv,
  type AnalyticsSnapshot,
  type PostCtx,
  type Publisher,
  type PublishResult,
  type SocialAccountCtx,
} from './types.js';

const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ');

async function refreshIfExpired(env: Env, acc: SocialAccountCtx): Promise<void> {
  if (!acc.token_expires_at) return;
  if (new Date(acc.token_expires_at).getTime() > Date.now() + 60_000) return;
  if (!acc.refresh_token) throw new Error('twitter_refresh_token_missing');
  const creds = requireEnv(env, 'twitter', 'https://developer.x.com/en/portal/dashboard', 'TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET');
  const basic = btoa(`${creds.TWITTER_CLIENT_ID}:${creds.TWITTER_CLIENT_SECRET}`);
  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: acc.refresh_token }).toString(),
  });
  if (!res.ok) throw new Error(`twitter_refresh_failed:${res.status}`);
  const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  acc.access_token = data.access_token;
  if (data.refresh_token) acc.refresh_token = data.refresh_token;
  const exp = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null;
  acc.token_expires_at = exp;
  if (acc.onTokenRefresh) await acc.onTokenRefresh({ access_token: acc.access_token, refresh_token: acc.refresh_token, expires_at: exp });
}

export const twitter: Publisher = {
  authorizeUrl(env, { state, codeVerifier, redirectUri }) {
    const clientId = (env as unknown as Record<string, string>).TWITTER_CLIENT_ID;
    if (!clientId) return null;
    // PKCE challenge = base64url(sha256(verifier)) — Twitter accepts "plain" too for dev
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge: codeVerifier,
      code_challenge_method: 'plain',
    });
    return `https://x.com/i/oauth2/authorize?${params.toString()}`;
  },
  async exchangeCode(env, { code, codeVerifier, redirectUri }) {
    const creds = requireEnv(env, 'twitter', 'https://developer.x.com/en/portal/dashboard', 'TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET');
    const basic = btoa(`${creds.TWITTER_CLIENT_ID}:${creds.TWITTER_CLIENT_SECRET}`);
    const res = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: creds.TWITTER_CLIENT_ID,
      }).toString(),
    });
    if (!res.ok) throw new Error(`twitter_exchange_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
    // Fetch user info for handle/display_name
    const meRes = await fetch('https://api.x.com/2/users/me', {
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${data.access_token}` },
    });
    const me = meRes.ok ? ((await meRes.json()) as { data?: { id: string; username: string; name: string } }) : { data: undefined };
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_in: data.expires_in ?? null,
      external_id: me.data?.id ?? null,
      handle: me.data?.username ? `@${me.data.username}` : null,
      display_name: me.data?.name ?? null,
      scopes: data.scope ?? SCOPES,
    };
  },
  async publish(env, account, post): Promise<PublishResult> {
    await refreshIfExpired(env, account);
    const text = composeContent(post, 'twitter').slice(0, 280);
    const body: Record<string, unknown> = { text };
    // Note: media upload via v1.1 endpoint would go here; we ship text-only first.
    const res = await fetch('https://api.x.com/2/tweets', {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`twitter_publish_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { data: { id: string; text: string } };
    const handle = (account.handle ?? '').replace(/^@/, '');
    return { external_id: data.data.id, external_url: `https://x.com/${handle || 'i'}/status/${data.data.id}` };
  },
  async fetchAnalytics(env, account, externalPostId): Promise<AnalyticsSnapshot> {
    await refreshIfExpired(env, account);
    const url = `https://api.x.com/2/tweets/${externalPostId}?tweet.fields=public_metrics,non_public_metrics`;
    const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.access_token}` } });
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as {
      data?: {
        public_metrics?: { retweet_count?: number; reply_count?: number; like_count?: number; quote_count?: number; impression_count?: number; bookmark_count?: number };
        non_public_metrics?: { impression_count?: number; url_link_clicks?: number };
      };
    };
    const pm = data.data?.public_metrics ?? {};
    const npm = data.data?.non_public_metrics ?? {};
    return {
      impressions: npm.impression_count ?? pm.impression_count ?? null,
      reach: null,
      likes: pm.like_count ?? null,
      comments: pm.reply_count ?? null,
      shares: (pm.retweet_count ?? 0) + (pm.quote_count ?? 0),
      clicks: npm.url_link_clicks ?? null,
      saves: pm.bookmark_count ?? null,
      raw: data,
    };
  },
};

void MissingAppCredsError;
