/**
 * YouTube publisher — Google OAuth 2.0 + YouTube Data API v3.
 *
 * @remarks
 * YouTube uses Google's OAuth 2.0 flow. Posting uploads a video via the
 * resumable upload protocol. The post content becomes the video title +
 * description. Rate limit: 10,000 units/day (upload = 1,600 units).
 *
 * @see https://developers.google.com/youtube/v3/docs/
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

const PLATFORM: Platform = 'youtube';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/youtube/v3/';

export const youtube: Publisher = {
  authorizeUrl(env, { state, codeVerifier, redirectUri }) {
    const { YOUTUBE_CLIENT_ID } = requireEnv(
      env,
      PLATFORM,
      'https://console.cloud.google.com/apis/credentials',
      'YOUTUBE_CLIENT_ID',
    );
    const params = new URLSearchParams({
      client_id: YOUTUBE_CLIENT_ID,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/youtube.upload',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeVerifier,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(env, { code, codeVerifier, redirectUri }) {
    const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET } = requireEnv(
      env,
      PLATFORM,
      'https://console.cloud.google.com/apis/credentials',
      'YOUTUBE_CLIENT_ID',
      'YOUTUBE_CLIENT_SECRET',
    );
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...BROWSER_HEADERS },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`youtube_token_exchange: ${res.status}`);
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    return {
      access_token: json.access_token,
      refresh_token: json.refresh_token ?? null,
      expires_in: json.expires_in ?? null,
    };
  },

  async publish(env, account, post): Promise<PublishResult> {
    const body = composeContent(post, PLATFORM);
    const title = body.split('\n')[0]?.slice(0, 100) ?? 'New video';
    const description = body.slice(title.length).trim().slice(0, 4900);

    const snippet = {
      snippet: {
        title,
        description,
        tags: post.hashtags.slice(0, 20),
      },
      status: { privacyStatus: 'public' },
    };

    const res = await fetch(`${API_BASE}videos?part=snippet,status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify(snippet),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error(`youtube_refresh_failed: ${res.status}`);
      throw new Error(`youtube_publish: ${res.status}`);
    }
    const json = (await res.json()) as { id?: string };
    return {
      external_id: json.id ?? '',
      external_url: `https://www.youtube.com/watch?v=${json.id ?? ''}`,
    };
  },

  async fetchAnalytics(_env, _account, _externalPostId): Promise<AnalyticsSnapshot> {
    return emptyAnalytics();
  },

  async uploadMedia(env, account, file) {
    const metadata = {
      snippet: { title: file.filename, description: '' },
      status: { privacyStatus: 'private' },
    };
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('media', new Blob([file.buffer], { type: file.mime }), file.filename);

    const res = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${account.access_token}`, ...BROWSER_HEADERS },
        body: formData,
      },
    );
    if (!res.ok) throw new Error(`youtube_upload: ${res.status}`);
    const json = (await res.json()) as { id?: string };
    return { mediaId: json.id ?? '' };
  },

  async getProfile(env, account) {
    const res = await fetch(
      `${API_BASE}channels?part=snippet,statistics&mine=true`,
      { headers: { Authorization: `Bearer ${account.access_token}`, ...BROWSER_HEADERS } },
    );
    if (!res.ok) throw new Error(`youtube_profile: ${res.status}`);
    const json = (await res.json()) as {
      items?: Array<{ snippet?: { title?: string; thumbnails?: { default?: { url?: string } } }; statistics?: { subscriberCount?: string } }>;
    };
    const channel = json.items?.[0];
    return {
      handle: channel?.snippet?.title ?? account.handle ?? '',
      display_name: channel?.snippet?.title ?? '',
      avatar_url: channel?.snippet?.thumbnails?.default?.url ?? '',
      follower_count: channel?.statistics?.subscriberCount ? Number(channel.statistics.subscriberCount) : undefined,
    };
  },
};
