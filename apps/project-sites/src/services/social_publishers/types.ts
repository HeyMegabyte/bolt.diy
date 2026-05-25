/**
 * @module services/social_publishers/types
 * @description Shared interfaces for per-platform publishers.
 *
 * Every Pulse Social publisher exports `publish` + `fetchAnalytics`
 * implementing this interface. Token refresh is the publisher's responsibility
 * — callers pass a decrypted `SocialAccountCtx` and the publisher writes
 * refreshed tokens back via `onTokenRefresh`.
 */
import type { Env } from '../../types/env.js';

/** Realistic browser UA per fetch-defaults rule (rotates quarterly). */
export const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Default browser-like header bundle for outbound API calls. */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': REAL_UA,
  'Accept-Language': 'en-US,en;q=0.9',
};

/** Supported platforms. */
export type Platform =
  | 'twitter'
  | 'linkedin'
  | 'facebook'
  | 'instagram'
  | 'threads'
  | 'bluesky'
  | 'reddit'
  | 'mastodon'
  | 'discord'
  | 'slack'
  | 'telegram';

export const PLATFORMS: readonly Platform[] = [
  'twitter',
  'linkedin',
  'facebook',
  'instagram',
  'threads',
  'bluesky',
  'reddit',
  'mastodon',
  'discord',
  'slack',
  'telegram',
] as const;

/**
 * Decrypted social-account context handed to publishers. The route layer
 * pulls the row from `social_accounts`, decrypts tokens via ai_crypto, and
 * builds this object.
 */
export interface SocialAccountCtx {
  id: string;
  org_id: string;
  platform: Platform;
  external_id: string | null;
  handle: string | null;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  metadata: Record<string, unknown>;
  /**
   * Async callback the publisher invokes after refreshing OAuth tokens.
   * The route layer re-encrypts the new pair and writes back to D1.
   */
  onTokenRefresh?: (next: {
    access_token: string;
    refresh_token?: string | null;
    expires_at?: string | null;
  }) => Promise<void>;
}

/** Subset of `pulse_posts` row shape that publishers can read. */
export interface PostCtx {
  id: string;
  content: string;
  per_platform_overrides: Record<string, { content?: string; alt?: string }> | null;
  /** Pre-signed R2 URLs for each attached media item. */
  media_urls: { url: string; mime: string; type: 'image' | 'video'; alt?: string }[];
  hashtags: string[];
  mentions: { platform: string; handle: string }[];
  link: string | null;
}

/** Successful publish result. */
export interface PublishResult {
  external_id: string;
  external_url: string;
}

/** Analytics snapshot from a platform metrics endpoint. */
export interface AnalyticsSnapshot {
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  clicks: number | null;
  saves: number | null;
  raw: unknown;
}

/** Thrown when required app credentials are missing from env. */
export class MissingAppCredsError extends Error {
  readonly platform: Platform;
  readonly deeplink: string;
  constructor(platform: Platform, deeplink: string, vars: readonly string[]) {
    super(`Missing app credentials for ${platform}: ${vars.join(', ')}. Configure at ${deeplink}`);
    this.platform = platform;
    this.deeplink = deeplink;
    this.name = 'MissingAppCredsError';
  }
}

/** Per-platform publisher contract. */
export interface Publisher {
  /** Build the OAuth authorize URL with PKCE state (or return null when no OAuth). */
  authorizeUrl?(env: Env, args: { state: string; codeVerifier: string; redirectUri: string }): string | null;
  /** Exchange OAuth callback code for tokens. */
  exchangeCode?(
    env: Env,
    args: { code: string; codeVerifier: string; redirectUri: string },
  ): Promise<{
    access_token: string;
    refresh_token?: string | null;
    expires_in?: number | null;
    external_id?: string | null;
    handle?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    scopes?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  /** Publish a post; refresh expired tokens inline. */
  publish(env: Env, account: SocialAccountCtx, post: PostCtx): Promise<PublishResult>;
  /** Fetch analytics for a published post. */
  fetchAnalytics(
    env: Env,
    account: SocialAccountCtx,
    externalPostId: string,
  ): Promise<AnalyticsSnapshot>;
}

/** Compose per-platform content with per-platform overrides + hashtags. */
export function composeContent(post: PostCtx, platform: Platform): string {
  const override = post.per_platform_overrides?.[platform]?.content;
  let body = override ?? post.content;
  if (post.hashtags.length > 0 && !override) {
    const tags = post.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ');
    body = `${body}\n\n${tags}`;
  }
  if (post.link && !body.includes(post.link)) {
    body = `${body}\n${post.link}`;
  }
  return body;
}

/** Helper: assert env var present, else throw MissingAppCredsError. */
export function requireEnv(env: Env, platform: Platform, deeplink: string, ...vars: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const v of vars) {
    const val = (env as unknown as Record<string, unknown>)[v];
    if (typeof val === 'string' && val.length > 0) out[v] = val;
    else missing.push(v);
  }
  if (missing.length > 0) throw new MissingAppCredsError(platform, deeplink, missing);
  return out;
}

/** Empty analytics snapshot (for platforms that don't expose metrics). */
export function emptyAnalytics(raw: unknown = null): AnalyticsSnapshot {
  return {
    impressions: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    clicks: null,
    saves: null,
    raw,
  };
}
