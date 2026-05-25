/**
 * Threads — Meta's Threads API. Two-step publish (container → publish), uses
 * Threads Graph API endpoints separate from FB Graph.
 * Docs: https://developers.facebook.com/docs/threads/posts
 */
import {
  BROWSER_HEADERS,
  composeContent,
  emptyAnalytics,
  requireEnv,
  type AnalyticsSnapshot,
  type Publisher,
  type PublishResult,
} from './types.js';

const SCOPES = 'threads_basic,threads_content_publish,threads_manage_insights';
const GRAPH = 'https://graph.threads.net/v1.0';

export const threads: Publisher = {
  authorizeUrl(env, { state, redirectUri }) {
    const appId = (env as unknown as Record<string, string>).THREADS_APP_ID
      ?? (env as unknown as Record<string, string>).FACEBOOK_APP_ID;
    if (!appId) return null;
    return `https://threads.net/oauth/authorize?${new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      scope: SCOPES,
      response_type: 'code',
      state,
    }).toString()}`;
  },
  async exchangeCode(env, { code, redirectUri }) {
    const creds = requireEnv(env, 'threads', 'https://developers.facebook.com/apps/', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET');
    const res = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: creds.FACEBOOK_APP_ID,
        client_secret: creds.FACEBOOK_APP_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }).toString(),
    });
    if (!res.ok) throw new Error(`threads_exchange_failed:${res.status}`);
    const data = (await res.json()) as { access_token: string; user_id: string };
    const meRes = await fetch(`${GRAPH}/me?fields=username,name&access_token=${data.access_token}`, { headers: BROWSER_HEADERS });
    const me = meRes.ok ? ((await meRes.json()) as { username?: string; name?: string }) : {};
    return {
      access_token: data.access_token,
      external_id: data.user_id,
      handle: me.username ? `@${me.username}` : null,
      display_name: me.name ?? null,
      scopes: SCOPES,
    };
  },
  async publish(_env, account, post): Promise<PublishResult> {
    if (!account.external_id) throw new Error('threads_user_id_missing');
    const text = composeContent(post, 'threads').slice(0, 500);
    const params = new URLSearchParams({
      media_type: post.media_urls[0]?.type === 'image' ? 'IMAGE' : 'TEXT',
      text,
      access_token: account.access_token,
    });
    if (post.media_urls[0]?.type === 'image') params.set('image_url', post.media_urls[0].url);
    const cRes = await fetch(`${GRAPH}/${account.external_id}/threads`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    if (!cRes.ok) throw new Error(`threads_container_failed:${cRes.status}`);
    const c = (await cRes.json()) as { id: string };
    const pRes = await fetch(`${GRAPH}/${account.external_id}/threads_publish`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: c.id, access_token: account.access_token }).toString(),
    });
    if (!pRes.ok) throw new Error(`threads_publish_failed:${pRes.status}`);
    const p = (await pRes.json()) as { id: string };
    const handle = (account.handle ?? '').replace(/^@/, '');
    return { external_id: p.id, external_url: `https://www.threads.net/@${handle}/post/${p.id}` };
  },
  async fetchAnalytics(_env, account, externalPostId): Promise<AnalyticsSnapshot> {
    const metrics = 'views,likes,replies,reposts,quotes';
    const url = `${GRAPH}/${externalPostId}/insights?metric=${metrics}&access_token=${account.access_token}`;
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
    const m: Record<string, number | null> = {};
    for (const x of data.data ?? []) m[x.name] = x.values?.[0]?.value ?? null;
    return {
      impressions: m.views ?? null,
      reach: null,
      likes: m.likes ?? null,
      comments: m.replies ?? null,
      shares: (m.reposts ?? 0) + (m.quotes ?? 0) || null,
      clicks: null,
      saves: null,
      raw: data,
    };
  },
};
