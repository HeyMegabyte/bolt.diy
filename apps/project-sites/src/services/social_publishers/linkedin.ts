/**
 * LinkedIn — Marketing/UGC API. OAuth 2.0 authorization-code flow.
 * Docs: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/community-management/shares/posts-api
 */
import type { Env } from '../../types/env.js';
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

const SCOPES = 'r_liteprofile r_emailaddress w_member_social';

export const linkedin: Publisher = {
  authorizeUrl(env, { state, redirectUri }) {
    const clientId = (env as unknown as Record<string, string>).LINKEDIN_CLIENT_ID;
    if (!clientId) return null;
    return `https://www.linkedin.com/oauth/v2/authorization?${new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
    }).toString()}`;
  },
  async exchangeCode(env, { code, redirectUri }) {
    const creds = requireEnv(env, 'linkedin', 'https://www.linkedin.com/developers/apps', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET');
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: creds.LINKEDIN_CLIENT_ID,
        client_secret: creds.LINKEDIN_CLIENT_SECRET,
      }).toString(),
    });
    if (!res.ok) throw new Error(`linkedin_exchange_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${data.access_token}` },
    });
    const me = meRes.ok ? ((await meRes.json()) as { sub?: string; name?: string; picture?: string }) : {};
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? null,
      expires_in: data.expires_in ?? null,
      external_id: me.sub ?? null,
      display_name: me.name ?? null,
      avatar_url: me.picture ?? null,
      scopes: SCOPES,
    };
  },
  async publish(env, account, post): Promise<PublishResult> {
    if (!account.external_id) throw new Error('linkedin_external_id_missing');
    const text = composeContent(post, 'linkedin');
    const author = `urn:li:person:${account.external_id}`;
    const body = {
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };
    const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`linkedin_publish_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { id: string };
    const id = data.id.replace('urn:li:share:', '').replace('urn:li:ugcPost:', '');
    return { external_id: data.id, external_url: `https://www.linkedin.com/feed/update/${data.id}/` };
  },
  async fetchAnalytics(_env, account, externalPostId): Promise<AnalyticsSnapshot> {
    // LinkedIn analytics require Marketing Developer Platform access.
    const url = `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(externalPostId)}`;
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        Authorization: `Bearer ${account.access_token}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as {
      likesSummary?: { totalLikes?: number };
      commentsSummary?: { totalFirstLevelComments?: number };
    };
    return {
      impressions: null,
      reach: null,
      likes: data.likesSummary?.totalLikes ?? null,
      comments: data.commentsSummary?.totalFirstLevelComments ?? null,
      shares: null,
      clicks: null,
      saves: null,
      raw: data,
    };
  },
};
