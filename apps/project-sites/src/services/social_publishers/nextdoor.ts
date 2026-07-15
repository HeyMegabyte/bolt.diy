/**
 * Nextdoor publisher — OAuth 2.0 + Nextdoor Business API.
 *
 * @remarks
 * Nextdoor API requires business verification before posting. Posts appear
 * in the local neighborhood feed as business updates. Rate limit: 100
 * requests/hour per app. This client implements the full Publisher interface
 * but actual API calls will return 403 unless the app is verified.
 *
 * @see https://developer.nextdoor.com/
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

const PLATFORM: Platform = 'nextdoor';

const AUTH_URL = 'https://nextdoor.com/oauth/authorize';
const TOKEN_URL = 'https://api.nextdoor.com/v2/oauth/token';
const API_BASE = 'https://api.nextdoor.com/v2/';

export const nextdoor: Publisher = {
  authorizeUrl(env, { state, codeVerifier, redirectUri }) {
    const { NEXTDOOR_CLIENT_ID } = requireEnv(
      env,
      PLATFORM,
      'https://developer.nextdoor.com/apps/',
      'NEXTDOOR_CLIENT_ID',
    );
    const params = new URLSearchParams({
      client_id: NEXTDOOR_CLIENT_ID,
      response_type: 'code',
      scope: 'business.read,business.write',
      redirect_uri: redirectUri,
      state,
      code_challenge: codeVerifier,
      code_challenge_method: 'S256',
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode(env, { code, codeVerifier, redirectUri }) {
    const { NEXTDOOR_CLIENT_ID, NEXTDOOR_CLIENT_SECRET } = requireEnv(
      env,
      PLATFORM,
      'https://developer.nextdoor.com/apps/',
      'NEXTDOOR_CLIENT_ID',
      'NEXTDOOR_CLIENT_SECRET',
    );
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...BROWSER_HEADERS },
      body: new URLSearchParams({
        client_id: NEXTDOOR_CLIENT_ID,
        client_secret: NEXTDOOR_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`nextdoor_token_exchange: ${res.status}`);
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
    const pageId = (account.metadata as Record<string, unknown>).page_id as string | undefined;
    if (!pageId) throw new Error('nextdoor_publish: page_id required in account metadata');

    const payload: Record<string, unknown> = {
      body_text: body.slice(0, 5000),
    };
    if (post.media_urls[0]) {
      payload.media_attachments = post.media_urls.map((m) => ({
        type: m.type === 'video' ? 'VIDEO' : 'PHOTO',
        url: m.url,
      }));
    }
    if (post.link) payload.link_url = post.link;

    const res = await fetch(`${API_BASE}pages/${pageId}/posts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error(`nextdoor_refresh_failed: ${res.status}`);
      throw new Error(`nextdoor_publish: ${res.status}`);
    }
    const json = (await res.json()) as { id?: string };
    return {
      external_id: json.id ?? '',
      external_url: `https://nextdoor.com/pages/${pageId}/posts/${json.id ?? ''}`,
    };
  },

  async fetchAnalytics(_env, _account, _externalPostId): Promise<AnalyticsSnapshot> {
    return emptyAnalytics();
  },

  async uploadMedia(_env, _account, _file) {
    return { mediaId: '' };
  },

  async getProfile(env, account) {
    const pageId = (account.metadata as Record<string, unknown>).page_id as string | undefined;
    if (!pageId) return { handle: account.handle ?? '', display_name: '', avatar_url: '' };
    const res = await fetch(`${API_BASE}pages/${pageId}`, {
      headers: { Authorization: `Bearer ${account.access_token}`, ...BROWSER_HEADERS },
    });
    if (!res.ok) throw new Error(`nextdoor_profile: ${res.status}`);
    const json = (await res.json()) as { name?: string; profile_photo_url?: string };
    return {
      handle: account.handle ?? '',
      display_name: json.name ?? '',
      avatar_url: json.profile_photo_url ?? '',
    };
  },
};
