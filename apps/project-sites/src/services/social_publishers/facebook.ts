/**
 * Facebook Pages — Graph API. OAuth + page-level access token.
 * Docs: https://developers.facebook.com/docs/pages-api/posts
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
} from './types.js';

const SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts,public_profile';
const GRAPH = 'https://graph.facebook.com/v21.0';

export const facebook: Publisher = {
  authorizeUrl(env, { state, redirectUri }) {
    const appId = (env as unknown as Record<string, string>).FACEBOOK_APP_ID;
    if (!appId) return null;
    return `https://www.facebook.com/v21.0/dialog/oauth?${new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      scope: SCOPES,
      response_type: 'code',
    }).toString()}`;
  },
  async exchangeCode(env, { code, redirectUri }) {
    const creds = requireEnv(env, 'facebook', 'https://developers.facebook.com/apps/', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET');
    const res = await fetch(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: creds.FACEBOOK_APP_ID,
        client_secret: creds.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      }).toString()}`,
      { headers: BROWSER_HEADERS },
    );
    if (!res.ok) throw new Error(`facebook_exchange_failed:${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    // Exchange short-lived → long-lived user token
    const longRes = await fetch(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: creds.FACEBOOK_APP_ID,
        client_secret: creds.FACEBOOK_APP_SECRET,
        fb_exchange_token: data.access_token,
      }).toString()}`,
      { headers: BROWSER_HEADERS },
    );
    const long = longRes.ok ? ((await longRes.json()) as { access_token: string; expires_in?: number }) : data;
    // Fetch the first page the user manages — Pulse posts to that page
    const pagesRes = await fetch(`${GRAPH}/me/accounts?access_token=${long.access_token}`, { headers: BROWSER_HEADERS });
    const pages = pagesRes.ok
      ? ((await pagesRes.json()) as { data?: Array<{ id: string; name: string; access_token: string }> })
      : { data: [] };
    const page = pages.data?.[0];
    if (!page) throw new Error('facebook_no_pages_found');
    return {
      access_token: page.access_token, // page-scoped token
      expires_in: long.expires_in ?? null,
      external_id: page.id,
      handle: page.name,
      display_name: page.name,
      scopes: SCOPES,
      metadata: { user_token: long.access_token, page_id: page.id },
    };
  },
  async publish(_env, account, post): Promise<PublishResult> {
    if (!account.external_id) throw new Error('facebook_page_id_missing');
    const text = composeContent(post, 'facebook');
    const body = new URLSearchParams({ message: text, access_token: account.access_token });
    if (post.link) body.set('link', post.link);
    const res = await fetch(`${GRAPH}/${account.external_id}/feed`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`facebook_publish_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { id: string };
    return { external_id: data.id, external_url: `https://www.facebook.com/${data.id}` };
  },
  async fetchAnalytics(_env, account, externalPostId): Promise<AnalyticsSnapshot> {
    const metrics = 'post_impressions,post_impressions_unique,post_clicks,post_reactions_by_type_total';
    const url = `${GRAPH}/${externalPostId}/insights?metric=${metrics}&access_token=${account.access_token}`;
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as {
      data?: Array<{ name: string; values?: Array<{ value: unknown }> }>;
    };
    const map: Record<string, unknown> = {};
    for (const m of data.data ?? []) map[m.name] = m.values?.[0]?.value;
    const reactions = (map.post_reactions_by_type_total as Record<string, number> | undefined) ?? {};
    const likes = Object.values(reactions).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
    return {
      impressions: typeof map.post_impressions === 'number' ? map.post_impressions : null,
      reach: typeof map.post_impressions_unique === 'number' ? map.post_impressions_unique : null,
      likes: likes || null,
      comments: null,
      shares: null,
      clicks: typeof map.post_clicks === 'number' ? map.post_clicks : null,
      saves: null,
      raw: data,
    };
  },
};
