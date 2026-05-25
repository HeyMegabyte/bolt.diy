/**
 * Bluesky — AT Protocol. Uses identifier + app-password (no OAuth app
 * credentials required). Stores the access JWT after login; refreshes via
 * com.atproto.server.refreshSession when needed.
 * Docs: https://docs.bsky.app/docs/api/com-atproto-repo-create-record
 */
import {
  BROWSER_HEADERS,
  composeContent,
  emptyAnalytics,
  type AnalyticsSnapshot,
  type Publisher,
  type PublishResult,
  type SocialAccountCtx,
} from './types.js';

const PDS = 'https://bsky.social';

async function refreshIfExpired(account: SocialAccountCtx): Promise<void> {
  if (!account.refresh_token) return;
  // JWT-based; brute-force refresh if access token > 90 min old
  if (account.token_expires_at && new Date(account.token_expires_at).getTime() > Date.now() + 60_000) return;
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.refreshSession`, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.refresh_token}` },
  });
  if (!res.ok) throw new Error(`bluesky_refresh_failed:${res.status}`);
  const data = (await res.json()) as { accessJwt: string; refreshJwt: string };
  account.access_token = data.accessJwt;
  account.refresh_token = data.refreshJwt;
  const exp = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  account.token_expires_at = exp;
  if (account.onTokenRefresh) await account.onTokenRefresh({ access_token: data.accessJwt, refresh_token: data.refreshJwt, expires_at: exp });
}

export const bluesky: Publisher = {
  // No OAuth — login via identifier + app-password handled in social.ts paste flow.
  async publish(_env, account, post): Promise<PublishResult> {
    await refreshIfExpired(account);
    const text = composeContent(post, 'bluesky').slice(0, 300);
    const body = {
      repo: account.external_id, // user's DID
      collection: 'app.bsky.feed.post',
      record: {
        $type: 'app.bsky.feed.post',
        text,
        createdAt: new Date().toISOString(),
        ...(post.link && {
          facets: [
            {
              index: { byteStart: text.indexOf(post.link), byteEnd: text.indexOf(post.link) + post.link.length },
              features: [{ $type: 'app.bsky.richtext.facet#link', uri: post.link }],
            },
          ],
        }),
      },
    };
    const res = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`bluesky_publish_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { uri: string; cid: string };
    const rkey = data.uri.split('/').pop();
    const handle = (account.handle ?? account.external_id ?? '').replace(/^@/, '');
    return { external_id: data.uri, external_url: `https://bsky.app/profile/${handle}/post/${rkey}` };
  },
  async fetchAnalytics(_env, account, externalPostId): Promise<AnalyticsSnapshot> {
    await refreshIfExpired(account);
    const url = `${PDS}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(externalPostId)}&depth=0`;
    const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.access_token}` } });
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as {
      thread?: { post?: { likeCount?: number; repostCount?: number; replyCount?: number; quoteCount?: number } };
    };
    const p = data.thread?.post ?? {};
    return {
      impressions: null,
      reach: null,
      likes: p.likeCount ?? null,
      comments: p.replyCount ?? null,
      shares: (p.repostCount ?? 0) + (p.quoteCount ?? 0) || null,
      clicks: null,
      saves: null,
      raw: data,
    };
  },
};

/** Bluesky-specific login helper, called by the social.ts paste route. */
export async function blueskyLogin(identifier: string, appPassword: string): Promise<{
  access_token: string;
  refresh_token: string;
  external_id: string;
  handle: string;
  display_name: string | null;
  expires_at: string;
}> {
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: appPassword }),
  });
  if (!res.ok) throw new Error(`bluesky_login_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { accessJwt: string; refreshJwt: string; did: string; handle: string };
  return {
    access_token: data.accessJwt,
    refresh_token: data.refreshJwt,
    external_id: data.did,
    handle: data.handle,
    display_name: data.handle,
    expires_at: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
  };
}
