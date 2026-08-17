/**
 * @module routes/social_oauth
 * @description Pulse Social — per-platform OAuth bootstrap.
 *
 *   GET  /api/social/:platform/connect              → build authorize URL or paste-key spec
 *   GET  /api/social/:platform/callback?code&state  → exchange code, encrypt, upsert
 *   POST /api/social/:platform/paste                → paste-key/login flow (Bluesky, Mastodon)
 *
 * PKCE state stored in KV `social-oauth-state:{state}` (5 min TTL).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { safeRelativePath } from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';
import { encrypt } from '../services/ai_crypto.js';
import { dbExecute } from '../services/db.js';
import {
  getPublisher,
  PLATFORMS,
  MissingAppCredsError,
  type Platform,
} from '../services/social_publishers/index.js';
import { blueskyLogin } from '../services/social_publishers/bluesky.js';
import { mastodonVerify } from '../services/social_publishers/mastodon.js';

export const socialOauthRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const OAUTH_STATE_TTL = 300; // 5 min

function isPlatform(p: string): p is Platform {
  return (PLATFORMS as readonly string[]).includes(p);
}

function redirectUriFor(req: Request, platform: Platform): string {
  const url = new URL(req.url);
  return `${url.origin}/api/social/${platform}/callback`;
}

/**
 * `GET /api/social/:platform/connect` — Start social-platform OAuth.
 *
 * @remarks
 * Generates PKCE state, stashes it in KV under
 * `social-oauth-state:{state}` (5 min TTL), and returns either a redirect
 * to the platform authorize URL or a paste-key form spec for platforms
 * without OAuth (Bluesky, Mastodon).
 *
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when `platform` isn't a known publisher.
 * @throws 501 NOT_IMPLEMENTED when the platform OAuth client_id env vars
 *   are missing — UI falls back to paste-key.
 */
socialOauthRoutes.get('/api/social/:platform/connect', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId)
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
  const platform = c.req.param('platform');
  if (!isPlatform(platform))
    return c.json({ error: { code: 'NOT_FOUND', message: 'unknown platform' } }, 404);

  const siteId = c.req.query('site_id') ?? null;
  // Same-origin relative path only — the callback composes
  // `https://projectsites.dev${returnUrl}`; an unchecked `@evil.com` would be
  // an open redirect post-auth.
  const returnUrl = safeRelativePath(c.req.query('return_url'), '/admin/social');
  const pub = getPublisher(platform);

  // Platforms with no OAuth dance get a paste-key spec
  if (!pub.authorizeUrl) {
    return c.json({
      data: {
        mode: 'paste_key',
        platform,
        instructions:
          platform === 'bluesky'
            ? 'Paste your Bluesky identifier (handle or email) and an app password from https://bsky.app/settings/app-passwords.'
            : platform === 'mastodon'
              ? 'Paste your Mastodon instance URL (e.g. https://mastodon.social) and an access token from Settings → Development.'
              : platform === 'telegram'
                ? 'Paste the chat_id of the channel or group where the bot should post (the bot must already be added).'
                : platform === 'discord'
                  ? 'Paste the Discord channel ID where the bot should post (the bot must already be invited).'
                  : 'Paste your API token.',
      },
    });
  }

  const redirectUri = redirectUriFor(c.req.raw, platform);
  const state = crypto.randomUUID().replace(/-/g, '');
  const codeVerifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48))))
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 64);
  let authorizeUrl: string | null;
  try {
    authorizeUrl = pub.authorizeUrl(c.env, { state, codeVerifier, redirectUri });
  } catch (err) {
    if (err instanceof MissingAppCredsError) {
      return c.json(
        { error: { code: 'APP_CREDS_MISSING', message: err.message, deeplink: err.deeplink } },
        501,
      );
    }
    throw err;
  }
  if (!authorizeUrl) {
    return c.json(
      {
        error: { code: 'APP_CREDS_MISSING', message: `${platform} OAuth client ID not configured` },
      },
      501,
    );
  }

  await c.env.CACHE_KV.put(
    `social-oauth-state:${state}`,
    JSON.stringify({
      org_id: orgId,
      user_id: userId,
      site_id: siteId,
      platform,
      code_verifier: codeVerifier,
      return_url: returnUrl,
      redirect_uri: redirectUri,
    }),
    { expirationTtl: OAUTH_STATE_TTL },
  );
  // Return the authorize URL as JSON (NOT a 302). The admin opens this endpoint
  // via an authenticated fetch (the bearer can't ride a `window.open` browser
  // navigation — that was the "auth required" 401 when connecting X/Twitter), so
  // the client reads `authorize_url` and opens the popup itself.
  return c.json({ data: { mode: 'oauth', authorize_url: authorizeUrl } });
});

// ── GET /api/social/:platform/callback ──────────────────────
/**
 * `GET /api/social/:platform/callback?code=&state=` — OAuth redirect
 * landing endpoint.
 *
 * @remarks
 * Validates the state KV row, exchanges the code via the platform
 * publisher's `exchangeCode`, encrypts tokens via {@link encrypt}
 * (AES-GCM per-record IV), upserts into `social_accounts` keyed by
 * `(org_id, platform, platform_user_id)`, then redirects back to the
 * dashboard.
 *
 * @throws 400 BAD_REQUEST when `code`/`state` missing or state expired.
 * @throws 404 NOT_FOUND when `platform` isn't a known publisher.
 * @throws 502 BAD_GATEWAY when the upstream token exchange fails.
 */
/**
 * Popup-bridge page for the social OAuth callback: `postMessage`s the opener (the
 * admin tab that launched the connect popup) with the real result — the
 * `/admin/social` listener already handles `social-oauth-success` /
 * `social-oauth-error` — then self-closes, rather than 302-redirecting the POPUP
 * into the full SPA (which never triggered those listeners). Falls back to
 * navigating `returnUrl` when there is no opener (full-page flow) or `window.close()`
 * is blocked. No user-controlled interpolation: `platform` is a validated enum and
 * `returnUrl` is a `safeRelativePath`.
 *
 * @param ok - Whether the connection was persisted (`false` → `social-oauth-error`).
 * @param platform - The validated platform id.
 * @param returnUrl - Safe relative return path.
 * @returns HTML document string.
 */
function socialOauthResultPage(ok: boolean, platform: string, returnUrl: string): string {
  const type = ok ? 'social-oauth-success' : 'social-oauth-error';
  const dot = ok ? '✓' : '✕';
  const color = ok ? '#00e5ff' : '#ff6b6b';
  const text = ok
    ? `${platform} connected. You can close this window.`
    : `Couldn't save the ${platform} connection. Close this window and try again.`;
  const payload = JSON.stringify({ type, platform });
  const url = `https://projectsites.dev${returnUrl}?${ok ? 'connected' : 'error'}=${platform}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? 'Connected' : 'Connection failed'}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#060610;color:#f4f4ff;display:grid;place-items:center;min-height:100vh;margin:0}.c{text-align:center;max-width:24rem;padding:1.5rem}.dot{color:${color};font-size:2rem;line-height:1}p{opacity:.8;font-size:.9rem;margin:.6rem 0 0}</style></head><body><div class="c"><div class="dot">${dot}</div><p>${text}</p></div><script>(function(){var payload=${payload};var returnUrl=${JSON.stringify(url)};try{if(window.opener){window.opener.postMessage(payload,"https://projectsites.dev");}}catch(e){}setTimeout(function(){try{window.close();}catch(e){}setTimeout(function(){try{window.location.replace(returnUrl);}catch(e){}},500);},120);})();</script></body></html>`;
}

socialOauthRoutes.get('/api/social/:platform/callback', async (c) => {
  const platform = c.req.param('platform');
  if (!isPlatform(platform))
    return c.json({ error: { code: 'NOT_FOUND', message: 'unknown platform' } }, 404);
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state)
    return c.json({ error: { code: 'BAD_REQUEST', message: 'code + state required' } }, 400);

  const stored = await c.env.CACHE_KV.get(`social-oauth-state:${state}`);
  if (!stored)
    return c.json({ error: { code: 'BAD_REQUEST', message: 'state expired or invalid' } }, 400);
  const ctx = JSON.parse(stored) as {
    org_id: string;
    user_id: string;
    site_id: string | null;
    platform: Platform;
    code_verifier: string;
    return_url: string;
    redirect_uri: string;
  };
  if (ctx.platform !== platform)
    return c.json({ error: { code: 'BAD_REQUEST', message: 'platform mismatch' } }, 400);

  const pub = getPublisher(platform);
  if (!pub.exchangeCode)
    return c.json(
      { error: { code: 'BAD_REQUEST', message: `${platform} has no exchange flow` } },
      400,
    );

  let exch;
  try {
    exch = await pub.exchangeCode(c.env, {
      code,
      codeVerifier: ctx.code_verifier,
      redirectUri: ctx.redirect_uri,
    });
  } catch (err) {
    if (err instanceof MissingAppCredsError) {
      return c.json(
        { error: { code: 'APP_CREDS_MISSING', message: err.message, deeplink: err.deeplink } },
        501,
      );
    }
    return c.json(
      {
        error: {
          code: 'OAUTH_EXCHANGE_FAILED',
          message: err instanceof Error ? err.message : 'exchange failed',
        },
      },
      502,
    );
  }

  const accessEnc = await encrypt(c.env, exch.access_token);
  const refreshEnc = exch.refresh_token ? await encrypt(c.env, exch.refresh_token) : null;
  const expiresAt = exch.expires_in
    ? new Date(Date.now() + exch.expires_in * 1000).toISOString()
    : null;

  const { error: persistErr } = await dbExecute(
    c.env.DB,
    `INSERT INTO social_accounts
       (id, org_id, created_by, platform, external_id, handle, display_name, avatar_url,
        access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
        token_expires_at, scopes, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'inline', ?, 'inline', ?, ?, 'active', ?)
     ON CONFLICT(org_id, platform, external_id) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       refresh_token_encrypted = excluded.refresh_token_encrypted,
       token_expires_at = excluded.token_expires_at,
       scopes = excluded.scopes,
       status = 'active',
       last_error = NULL,
       metadata_json = excluded.metadata_json,
       updated_at = datetime('now'),
       deleted_at = NULL`,
    [
      crypto.randomUUID(),
      ctx.org_id,
      ctx.user_id,
      platform,
      exch.external_id ?? null,
      exch.handle ?? null,
      exch.display_name ?? null,
      exch.avatar_url ?? null,
      accessEnc,
      refreshEnc,
      expiresAt,
      exch.scopes ?? null,
      exch.metadata ? JSON.stringify(exch.metadata) : null,
    ],
  );
  await c.env.CACHE_KV.delete(`social-oauth-state:${state}`);

  // The token exchange succeeded, but if PERSISTING the connection FAILED (dbExecute
  // returns `{ error }` — it NEVER throws), do NOT signal success. A bare `await`
  // here previously redirected `?connected=…` regardless → the opener toasted
  // "Connected" for a `social_accounts` row that was never written (a lying-success;
  // the accounts list then showed "Not connected" with no explanation). Bridge the
  // REAL outcome to the opener's existing `social-oauth-success` / `social-oauth-error`
  // listener (which the old 302-redirect never triggered), then self-close.
  return c.html(socialOauthResultPage(!persistErr, platform, ctx.return_url));
});

// ── POST /api/social/:platform/paste — paste-key/login flow ──
const PasteSchema = z.union([
  z.object({
    kind: z.literal('bluesky'),
    identifier: z.string().min(2).max(120),
    app_password: z.string().min(8).max(120),
  }),
  z.object({
    kind: z.literal('mastodon'),
    instance_url: z.string().url(),
    access_token: z.string().min(20).max(500),
  }),
  z.object({
    kind: z.literal('telegram'),
    chat_id: z.string().min(1).max(80),
    display_name: z.string().max(120).optional(),
  }),
  z.object({
    kind: z.literal('discord'),
    channel_id: z.string().min(5).max(40),
    display_name: z.string().max(120).optional(),
  }),
]);

/**
 * `POST /api/social/:platform/paste` — Paste-key / login flow for
 * platforms without OAuth (currently Bluesky via app-password,
 * Mastodon via access token).
 *
 * @remarks
 * Body: {@link PasteSchema}. Bluesky validates via
 * {@link blueskyLogin}; Mastodon via {@link mastodonVerify}. Encrypts
 * resulting tokens via {@link encrypt}.
 *
 * @throws 400 BAD_REQUEST when payload validation fails or credentials
 *   are rejected by the platform.
 * @throws 401 UNAUTHORIZED when org/user context is missing.
 * @throws 404 NOT_FOUND when `platform` isn't paste-key supported.
 */
socialOauthRoutes.post(
  '/api/social/:platform/paste',
  zValidator('json', PasteSchema),
  async (c) => {
    const orgId = c.get('orgId') as string | undefined;
    const userId = c.get('userId') as string | undefined;
    if (!orgId || !userId)
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'auth required' } }, 401);
    const platform = c.req.param('platform');
    if (!isPlatform(platform))
      return c.json({ error: { code: 'NOT_FOUND', message: 'unknown platform' } }, 404);
    const body = c.req.valid('json');

    let access_token: string;
    let refresh_token: string | null = null;
    let external_id: string | null = null;
    let handle: string | null = null;
    let display_name: string | null = null;
    let avatar_url: string | null = null;
    let metadata: Record<string, unknown> = {};
    let expires_at: string | null = null;

    if (body.kind === 'bluesky' && platform === 'bluesky') {
      const res = await blueskyLogin(body.identifier, body.app_password);
      access_token = res.access_token;
      refresh_token = res.refresh_token;
      external_id = res.external_id;
      handle = res.handle;
      display_name = res.display_name;
      expires_at = res.expires_at;
    } else if (body.kind === 'mastodon' && platform === 'mastodon') {
      const res = await mastodonVerify(body.instance_url, body.access_token);
      access_token = body.access_token;
      external_id = res.external_id;
      handle = res.handle;
      display_name = res.display_name;
      avatar_url = res.avatar_url;
      metadata = { instance_url: body.instance_url.replace(/\/$/, '') };
    } else if (body.kind === 'telegram' && platform === 'telegram') {
      access_token = 'shared_bot_token'; // sentinel; real token is env.TELEGRAM_BOT_TOKEN
      external_id = body.chat_id;
      handle = body.display_name ?? body.chat_id;
      display_name = body.display_name ?? null;
      metadata = { chat_id: body.chat_id };
    } else if (body.kind === 'discord' && platform === 'discord') {
      access_token = 'shared_bot_token';
      external_id = body.channel_id;
      handle = body.display_name ?? body.channel_id;
      display_name = body.display_name ?? null;
      metadata = { channel_id: body.channel_id };
    } else {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'kind/platform mismatch' } }, 400);
    }

    const accessEnc = await encrypt(c.env, access_token);
    const refreshEnc = refresh_token ? await encrypt(c.env, refresh_token) : null;

    await dbExecute(
      c.env.DB,
      `INSERT INTO social_accounts
       (id, org_id, created_by, platform, external_id, handle, display_name, avatar_url,
        access_token_encrypted, access_token_iv, refresh_token_encrypted, refresh_token_iv,
        token_expires_at, scopes, status, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'inline', ?, 'inline', ?, ?, 'active', ?)
     ON CONFLICT(org_id, platform, external_id) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       refresh_token_encrypted = excluded.refresh_token_encrypted,
       token_expires_at = excluded.token_expires_at,
       handle = excluded.handle,
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       status = 'active',
       last_error = NULL,
       metadata_json = excluded.metadata_json,
       updated_at = datetime('now'),
       deleted_at = NULL`,
      [
        crypto.randomUUID(),
        orgId,
        userId,
        platform,
        external_id,
        handle,
        display_name,
        avatar_url,
        accessEnc,
        refreshEnc,
        expires_at,
        null,
        JSON.stringify(metadata),
      ],
    );
    return c.json({ data: { connected: true, platform, handle, display_name } });
  },
);
