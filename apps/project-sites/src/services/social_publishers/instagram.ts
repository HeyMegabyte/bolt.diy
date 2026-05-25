/**
 * Instagram Graph API — relies on FB infrastructure (Instagram Business
 * account linked to a FB Page). Two-step publish: create media container
 * → publish container.
 * Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing
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

const SCOPES = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement';
const GRAPH = 'https://graph.facebook.com/v21.0';

export const instagram: Publisher = {
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
    const creds = requireEnv(env, 'instagram', 'https://developers.facebook.com/apps/', 'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET');
    const res = await fetch(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: creds.FACEBOOK_APP_ID,
        client_secret: creds.FACEBOOK_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      }).toString()}`,
      { headers: BROWSER_HEADERS },
    );
    if (!res.ok) throw new Error(`instagram_exchange_failed:${res.status}`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    // Find the user's Page → linked IG business account
    const pagesRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${data.access_token}`,
      { headers: BROWSER_HEADERS },
    );
    const pages = pagesRes.ok
      ? ((await pagesRes.json()) as {
          data?: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }>;
        })
      : { data: [] };
    const page = pages.data?.find((p) => p.instagram_business_account?.id);
    if (!page?.instagram_business_account) throw new Error('instagram_no_business_account');
    return {
      access_token: page.access_token,
      expires_in: data.expires_in ?? null,
      external_id: page.instagram_business_account.id,
      handle: page.name,
      display_name: page.name,
      scopes: SCOPES,
      metadata: { page_id: page.id },
    };
  },
  async publish(_env, account, post): Promise<PublishResult> {
    if (!account.external_id) throw new Error('instagram_business_account_missing');
    const text = composeContent(post, 'instagram');
    const firstImage = post.media_urls.find((m) => m.type === 'image');
    if (!firstImage) throw new Error('instagram_requires_image');
    // Step 1: create container
    const containerRes = await fetch(`${GRAPH}/${account.external_id}/media`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: firstImage.url,
        caption: text,
        access_token: account.access_token,
      }).toString(),
    });
    if (!containerRes.ok) throw new Error(`instagram_container_failed:${containerRes.status}`);
    const container = (await containerRes.json()) as { id: string };
    // Step 2: publish
    const pubRes = await fetch(`${GRAPH}/${account.external_id}/media_publish`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ creation_id: container.id, access_token: account.access_token }).toString(),
    });
    if (!pubRes.ok) throw new Error(`instagram_publish_failed:${pubRes.status}:${(await pubRes.text()).slice(0, 200)}`);
    const pub = (await pubRes.json()) as { id: string };
    // Permalink lookup
    const permRes = await fetch(`${GRAPH}/${pub.id}?fields=permalink&access_token=${account.access_token}`, { headers: BROWSER_HEADERS });
    const perm = permRes.ok ? ((await permRes.json()) as { permalink?: string }) : {};
    return { external_id: pub.id, external_url: perm.permalink ?? `https://www.instagram.com/p/${pub.id}/` };
  },
  async fetchAnalytics(_env, account, externalPostId): Promise<AnalyticsSnapshot> {
    const metrics = 'impressions,reach,likes,comments,saved,shares';
    const url = `${GRAPH}/${externalPostId}/insights?metric=${metrics}&access_token=${account.access_token}`;
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as { data?: Array<{ name: string; values?: Array<{ value: number }> }> };
    const m: Record<string, number | null> = {};
    for (const x of data.data ?? []) m[x.name] = x.values?.[0]?.value ?? null;
    return {
      impressions: m.impressions ?? null,
      reach: m.reach ?? null,
      likes: m.likes ?? null,
      comments: m.comments ?? null,
      shares: m.shares ?? null,
      clicks: null,
      saves: m.saved ?? null,
      raw: data,
    };
  },
};
