/**
 * Pinterest publisher — OAuth 2.0 + Pinterest API v5.
 *
 * @remarks
 * Pinterest API v5 uses OAuth 2.0 with standard code flow. Posting creates
 * a Pin on a board. Media must be uploaded first or referenced by URL.
 * Rate limit: 1,000 requests/hour per app.
 *
 * @see https://developers.pinterest.com/docs/api/v5/
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

const PLATFORM: Platform = 'pinterest';

const AUTH_URL = 'https://www.pinterest.com/oauth/';
const TOKEN_URL = 'https://api.pinterest.com/v5/oauth/token';
const API_BASE = 'https://api.pinterest.com/v5/';

export const pinterest: Publisher = {
  authorizeUrl(env, { state, codeVerifier, redirectUri }) {
    const { PINTEREST_CLIENT_ID } = requireEnv(
      env,
      PLATFORM,
      'https://developers.pinterest.com/apps/',
      'PINTEREST_CLIENT_ID',
    );
    const params = new URLSearchParams({
      client_id: PINTEREST_CLIENT_ID,
      response_type: 'code',
      scope: 'pins:read,pins:write,boards:read,boards:write,user_accounts:read',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeVerifier,
      code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(env, { code, codeVerifier, redirectUri }) {
    const { PINTEREST_CLIENT_ID, PINTEREST_CLIENT_SECRET } = requireEnv(
      env,
      PLATFORM,
      'https://developers.pinterest.com/apps/',
      'PINTEREST_CLIENT_ID',
      'PINTEREST_CLIENT_SECRET',
    );
    const auth = btoa(`${PINTEREST_CLIENT_ID}:${PINTEREST_CLIENT_SECRET}`);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...BROWSER_HEADERS,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });
    if (!res.ok) throw new Error(`pinterest_token_exchange: ${res.status}`);
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
    const title = body.split('\n')[0]?.slice(0, 100) ?? 'Pin';

    // Pinterest requires a board_id in the account metadata
    const boardId = (account.metadata as Record<string, unknown>).board_id as string | undefined;
    if (!boardId) throw new Error('pinterest_publish: board_id required in account metadata');

    const pin: Record<string, unknown> = {
      title,
      description: body.slice(0, 500),
      board_id: boardId,
    };
    if (post.media_urls[0]) {
      pin.media_source = {
        source_type: 'image_url',
        url: post.media_urls[0].url,
      };
    }
    if (post.link) pin.link = post.link;

    const res = await fetch(`${API_BASE}pins`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify(pin),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error(`pinterest_refresh_failed: ${res.status}`);
      throw new Error(`pinterest_publish: ${res.status}`);
    }
    const json = (await res.json()) as { id?: string };
    return {
      external_id: json.id ?? '',
      external_url: `https://www.pinterest.com/pin/${json.id ?? ''}`,
    };
  },

  async fetchAnalytics(_env, _account, _externalPostId): Promise<AnalyticsSnapshot> {
    return emptyAnalytics();
  },

  async uploadMedia(env, account, file) {
    const res = await fetch(`${API_BASE}media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify({
        media_type: file.mime.startsWith('video/') ? 'video' : 'image',
        attachment_type: 'media',
      }),
    });
    if (!res.ok) throw new Error(`pinterest_media_create: ${res.status}`);
    const json = (await res.json()) as { media_id?: string; upload_url?: string; upload_parameters?: Record<string, string> };
    if (json.upload_url && json.upload_parameters) {
      const fd = new FormData();
      for (const [k, v] of Object.entries(json.upload_parameters)) fd.append(k, v);
      fd.append('file', new Blob([file.buffer], { type: file.mime }), file.filename);
      const up = await fetch(json.upload_url, { method: 'POST', body: fd });
      if (!up.ok) throw new Error(`pinterest_media_upload: ${up.status}`);
    }
    return { mediaId: json.media_id ?? '' };
  },

  async getProfile(env, account) {
    const res = await fetch(`${API_BASE}user_account`, {
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        ...BROWSER_HEADERS,
      },
    });
    if (!res.ok) throw new Error(`pinterest_profile: ${res.status}`);
    const json = (await res.json()) as {
      username?: string;
      profile_image?: string;
    };
    return {
      handle: json.username ?? account.handle ?? '',
      display_name: json.username ?? '',
      avatar_url: json.profile_image ?? '',
    };
  },
};
