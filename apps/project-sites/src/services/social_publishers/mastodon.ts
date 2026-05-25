/**
 * Mastodon — Federated; account stores its instance URL in metadata.
 * Auth: each instance issues its own access token via app password or OAuth.
 * For Pulse we accept an access token + instance URL paste flow.
 * Docs: https://docs.joinmastodon.org/methods/statuses/
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

function instance(account: SocialAccountCtx): string {
  const m = (account.metadata?.instance_url as string | undefined) ?? 'https://mastodon.social';
  return m.replace(/\/$/, '');
}

export const mastodon: Publisher = {
  // Paste-flow only — no central OAuth (every instance has its own app registry).
  async publish(_env, account, post): Promise<PublishResult> {
    const text = composeContent(post, 'mastodon').slice(0, 500);
    const res = await fetch(`${instance(account)}/api/v1/statuses`, {
      method: 'POST',
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: text, visibility: 'public' }),
    });
    if (!res.ok) throw new Error(`mastodon_publish_failed:${res.status}:${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { id: string; url: string };
    return { external_id: data.id, external_url: data.url };
  },
  async fetchAnalytics(_env, account, externalPostId): Promise<AnalyticsSnapshot> {
    const res = await fetch(`${instance(account)}/api/v1/statuses/${externalPostId}`, {
      headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${account.access_token}` },
    });
    if (!res.ok) return emptyAnalytics({ status: res.status });
    const data = (await res.json()) as {
      reblogs_count?: number;
      favourites_count?: number;
      replies_count?: number;
    };
    return {
      impressions: null,
      reach: null,
      likes: data.favourites_count ?? null,
      comments: data.replies_count ?? null,
      shares: data.reblogs_count ?? null,
      clicks: null,
      saves: null,
      raw: data,
    };
  },
};

/** Verify a Mastodon token + return account details. */
export async function mastodonVerify(instanceUrl: string, accessToken: string): Promise<{
  external_id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
}> {
  const url = `${instanceUrl.replace(/\/$/, '')}/api/v1/accounts/verify_credentials`;
  const res = await fetch(url, { headers: { ...BROWSER_HEADERS, Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`mastodon_verify_failed:${res.status}`);
  const data = (await res.json()) as { id: string; username: string; display_name?: string; avatar?: string };
  return {
    external_id: data.id,
    handle: `@${data.username}`,
    display_name: data.display_name ?? null,
    avatar_url: data.avatar ?? null,
  };
}
