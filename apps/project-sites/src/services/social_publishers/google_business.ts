/**
 * Google Business Profile publisher — Google OAuth 2.0 + My Business API v4.
 *
 * @remarks
 * Posts to a Google Business Profile as "local posts" (What's New, Offer, Event).
 * Requires a verified Business Profile and the GBP API enabled in Google Cloud.
 * Rate limit: 10,000 queries/day per project.
 *
 * @see https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts
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

const PLATFORM: Platform = 'google_business';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://mybusiness.googleapis.com/v4/';

export const google_business: Publisher = {
  authorizeUrl(env, { state, codeVerifier, redirectUri }) {
    const { GBP_CLIENT_ID } = requireEnv(
      env,
      PLATFORM,
      'https://console.cloud.google.com/apis/credentials',
      'GBP_CLIENT_ID',
    );
    const params = new URLSearchParams({
      client_id: GBP_CLIENT_ID,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/business.manage',
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
    const { GBP_CLIENT_ID, GBP_CLIENT_SECRET } = requireEnv(
      env,
      PLATFORM,
      'https://console.cloud.google.com/apis/credentials',
      'GBP_CLIENT_ID',
      'GBP_CLIENT_SECRET',
    );
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...BROWSER_HEADERS },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new Error(`gbp_token_exchange: ${res.status}`);
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
    const locationId = (account.metadata as Record<string, unknown>).location_id as string | undefined;
    const accountId = (account.metadata as Record<string, unknown>).account_id as string | undefined;
    if (!locationId || !accountId) {
      throw new Error('gbp_publish: location_id and account_id required in metadata');
    }
    const body = composeContent(post, PLATFORM);
    const payload = {
      summary: body.slice(0, 1500),
      topicType: 'STANDARD',
      callToAction: post.link
        ? { actionType: 'LEARN_MORE', url: post.link }
        : undefined,
      media: post.media_urls.map((m) => ({
        mediaFormat: m.type === 'video' ? 'VIDEO' : 'PHOTO',
        sourceUrl: m.url,
      })),
    };

    const path = `${API_BASE}accounts/${accountId}/locations/${locationId}/localPosts`;
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.access_token}`,
        'Content-Type': 'application/json',
        ...BROWSER_HEADERS,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error(`gbp_refresh_failed: ${res.status}`);
      throw new Error(`gbp_publish: ${res.status}`);
    }
    const json = (await res.json()) as { name?: string };
    return {
      external_id: json.name ?? '',
      external_url: `https://www.google.com/maps/place/?q=place_id:${locationId}`,
    };
  },

  async fetchAnalytics(env, account, externalPostId): Promise<AnalyticsSnapshot> {
    const locationId = (account.metadata as Record<string, unknown>).location_id as string;
    if (!locationId || !externalPostId) return emptyAnalytics();
    try {
      const path = `${API_BASE}accounts/${String((account.metadata as Record<string, unknown>).account_id ?? '')}/locations/${locationId}/localPosts/${externalPostId}`;
      const res = await fetch(path, {
        headers: { Authorization: `Bearer ${account.access_token}`, ...BROWSER_HEADERS },
      });
      if (!res.ok) return emptyAnalytics();
      const json = (await res.json()) as {
        searchUrl?: { views?: number; clicks?: number };
      };
      return {
        impressions: json.searchUrl?.views ?? null,
        reach: null,
        likes: null,
        comments: null,
        shares: null,
        clicks: json.searchUrl?.clicks ?? null,
        saves: null,
        raw: json,
      };
    } catch {
      return emptyAnalytics();
    }
  },

  async uploadMedia(_env, _account, _file) {
    // GBP uses external URLs, not direct upload. Media is served from R2.
    return { mediaId: '' };
  },

  async getProfile(env, account) {
    const accountId = (account.metadata as Record<string, unknown>).account_id as string | undefined;
    if (!accountId) return { handle: account.handle ?? '', display_name: '', avatar_url: '' };
    const res = await fetch(
      `${API_BASE}accounts/${accountId}`,
      { headers: { Authorization: `Bearer ${account.access_token}`, ...BROWSER_HEADERS } },
    );
    if (!res.ok) throw new Error(`gbp_profile: ${res.status}`);
    const json = (await res.json()) as { name?: string; accountName?: string };
    return {
      handle: account.handle ?? '',
      display_name: json.accountName ?? json.name ?? '',
      avatar_url: '',
    };
  },
};
