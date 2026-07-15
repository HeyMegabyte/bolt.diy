/**
 * TikTok publisher — OAuth 2.0 + Content Posting API.
 *
 * @remarks
 * TikTok uses OAuth 2.0 with PKCE. Posting requires video upload first
 * (uploadMedia), then publish with the returned media ID.
 * Rate limit: 20 posts/day for unverified apps, 200/day verified.
 *
 * @see https://developers.tiktok.com/doc/content-posting-api/
 */
import type { Env } from '../../types/env.js';
import type {
  AnalyticsSnapshot,
  Platform,
  PostCtx,
  PublishResult,
  Publisher,
  SocialAccountCtx,
} from './types.js';
import { BROWSER_HEADERS, composeContent, emptyAnalytics, requireEnv } from './types.js';

const PLATFORM: Platform = 'tiktok';

const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const API_BASE = 'https://open.tiktokapis.com/v2/';

export const tiktok: Publisher = {
  authorizeUrl(env, { state, codeVerifier, redirectUri }) {
    const { TIKTOK_CLIENT_ID } = requireEnv(
      env,
      PLATFORM,
      'https://developers.tiktok.com/apps/',
      'TIKTOK_CLIENT_ID',
    );
    const params = new URLSearchParams({
      client_key: TIKTOK_CLIENT_ID,
      response_type: 'code',
      scope: 'user.info.basic,video.publish,video.upload',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeVerifier,
      code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(env, { code, codeVerifier, redirectUri }) {
    const { TIKTOK_CLIENT_ID, TIKTOK_CLIENT_SECRET } = requireEnv(
      env,
      PLATFORM,
      'https://developers.tiktok.com/apps/',
      'TIKTOK_CLIENT_ID',
      'TIKTOK_CLIENT_SECRET',
    );
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...BROWSER_HEADERS },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_ID,
        client_secret: TIKTOK_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`tiktok_token_exchange: ${res.status}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
    };
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? null,
      expires_in: json.expires_in ?? null,
      external_id: json.open_id ?? null,
    };
  },

  async publish(env, account, post) {
    const body = composeContent(post, PLATFORM);
    const res = await fetch(`${API_BASE}post/publish/video/init/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify({
        post_info: {
          title: body.slice(0, 2200),
          privacy_level: 'PUBLIC_TO_EVERYONE',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: { source: 'PULL_FROM_URL', video_url: post.media_urls[0]?.url ?? '' },
      }),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error(`tiktok_refresh_failed: ${res.status}`);
      throw new Error(`tiktok_publish: ${res.status} ${await res.text().catch(() => '')}`);
    }
    const json = (await res.json()) as {
      data?: { publish_id?: string };
      error?: { message: string };
    };
    if (json.error) throw new Error(`tiktok_publish: ${json.error.message}`);
    return {
      external_id: json.data?.publish_id ?? '',
      external_url: `https://www.tiktok.com/@${account.handle ?? 'user'}/video/${json.data?.publish_id ?? ''}`,
    };
  },

  async fetchAnalytics(_env, _account, _externalPostId): Promise<AnalyticsSnapshot> {
    return emptyAnalytics();
  },

  async uploadMedia(env, account, file) {
    const res = await fetch(`${API_BASE}video/upload/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': file.mime,
        ...BROWSER_HEADERS,
      },
      body: file.buffer,
    });
    if (!res.ok) throw new Error(`tiktok_upload: ${res.status}`);
    const json = (await res.json()) as { data?: { video_id?: string } };
    return { mediaId: json.data?.video_id ?? '' };
  },

  async getProfile(env, account) {
    const res = await fetch(`${API_BASE}user/info/`, {
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        ...BROWSER_HEADERS,
      },
    });
    if (!res.ok) throw new Error(`tiktok_profile: ${res.status}`);
    const json = (await res.json()) as {
      data?: { user?: { display_name?: string; avatar_url?: string; follower_count?: number } };
    };
    return {
      handle: account.handle ?? '',
      display_name: json.data?.user?.display_name ?? account.handle ?? '',
      avatar_url: json.data?.user?.avatar_url ?? '',
      follower_count: json.data?.user?.follower_count,
    };
  },
};
