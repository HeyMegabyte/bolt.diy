/**
 * Auth routes — every supported sign-in path per doctrine §23.
 *   - OAuth: Google, GitHub, Apple, Microsoft, Facebook (PKCE)
 *   - Magic link (email)
 *   - Voice OTP (Twilio Verify)
 *   - Passkey (WebAuthn)
 *   - TOTP (RFC 6238)
 *   - Sign-out
 */

import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { dbInsert, dbQueryOne, dbExecute } from '../services/db.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createSession,
  issueMagicLink,
  issueOAuthState,
  revokeSession,
} from '../services/auth.js';
import { sendEmail } from '../services/notifications.js';
import { startVoiceOtp, checkVoiceOtp } from '../services/twilio.js';
import { writeAudit } from '../services/audit.js';

const OAUTH_PROVIDERS = ['google', 'github', 'apple', 'microsoft', 'facebook'] as const;
type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

interface OAuthConfig {
  authUrl: string;
  tokenUrl: string;
  userUrl: string;
  scopes: string;
  emailKey: string;
  nameKey?: string;
}

const OAUTH_CONFIG: Record<OAuthProvider, OAuthConfig> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: 'openid email profile',
    emailKey: 'email',
    nameKey: 'name',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userUrl: 'https://api.github.com/user',
    scopes: 'read:user user:email',
    emailKey: 'email',
    nameKey: 'name',
  },
  apple: {
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    userUrl: '',
    scopes: 'name email',
    emailKey: 'email',
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scopes: 'openid email profile',
    emailKey: 'email',
    nameKey: 'name',
  },
  facebook: {
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userUrl: 'https://graph.facebook.com/me?fields=id,name,email',
    scopes: 'email,public_profile',
    emailKey: 'email',
    nameKey: 'name',
  },
};

const app = new Hono<HonoEnv>();
app.use('*', rateLimit('auth'));

// ─── OAuth start ─────────────────────────────────────────────────────────────
app.post(
  '/oauth/:provider/start',
  zValidator(
    'json',
    z.object({ redirect_to: z.string().url().optional() }).default({}),
  ),
  async (c) => {
    const provider = c.req.param('provider') as OAuthProvider;
    if (!OAUTH_PROVIDERS.includes(provider)) {
      throw new AppError(ErrorCode.BAD_REQUEST, `unknown provider ${provider}`);
    }
    const { clientId } = getOAuthCreds(c.env, provider);
    const cfg = OAUTH_CONFIG[provider];
    const body = c.req.valid('json');
    const { state, codeChallenge } = await issueOAuthState(c.env, {
      provider,
      redirectTo: body.redirect_to ?? c.env.APP_BASE_URL,
    });
    const redirectUri = `${c.env.API_BASE_URL}/auth/oauth/${provider}/callback`;
    const url = new URL(cfg.authUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', cfg.scopes);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return c.json({ authorize_url: url.toString(), state });
  },
);

// ─── OAuth callback ──────────────────────────────────────────────────────────
app.get('/oauth/:provider/callback', async (c) => {
  const provider = c.req.param('provider') as OAuthProvider;
  if (!OAUTH_PROVIDERS.includes(provider)) {
    throw new AppError(ErrorCode.BAD_REQUEST, `unknown provider ${provider}`);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'missing code or state');
  }
  const stateRow = await dbQueryOne<{
    provider: string;
    code_verifier: string;
    redirect_to: string | null;
    expires_at: number;
  }>(
    c.env.DB,
    `SELECT provider, code_verifier, redirect_to, expires_at FROM oauth_state WHERE state = ?1`,
    [state],
  );
  if (!stateRow || stateRow.expires_at < Date.now() || stateRow.provider !== provider) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'invalid or expired state');
  }
  await dbExecute(c.env.DB, `DELETE FROM oauth_state WHERE state = ?1`, [state]);

  const cfg = OAUTH_CONFIG[provider];
  const { clientId, clientSecret } = getOAuthCreds(c.env, provider);
  const redirectUri = `${c.env.API_BASE_URL}/auth/oauth/${provider}/callback`;
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: stateRow.code_verifier,
    }),
  });
  if (!tokenRes.ok) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, `oauth token exchange failed: ${await tokenRes.text()}`);
  }
  const tokenJson = (await tokenRes.json()) as { access_token: string };
  const accessToken = tokenJson.access_token;

  const userRes = await fetch(cfg.userUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!userRes.ok) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, `oauth userinfo failed: ${await userRes.text()}`);
  }
  const profile = (await userRes.json()) as Record<string, unknown>;
  const email = String(profile[cfg.emailKey] ?? '').toLowerCase();
  const name = cfg.nameKey ? (profile[cfg.nameKey] as string | undefined) : undefined;
  if (!email) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'provider returned no email');
  }
  const user = await upsertUser(c.env.DB, { email, name: name ?? null });
  const session = await createSession(c.env, {
    userId: user.id,
    orgId: null,
    ip: c.req.header('cf-connecting-ip') ?? null,
    ua: c.req.header('user-agent') ?? null,
  });
  await writeAudit(c.env, {
    actor_user_id: user.id,
    actor_email: user.email,
    tenant_id: null,
    event: `auth.oauth.${provider}.success`,
    target_type: 'user',
    target_id: user.id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  setSessionCookie(c, session.token);
  const redirectTo = stateRow.redirect_to ?? c.env.APP_BASE_URL;
  return c.redirect(redirectTo);
});

// ─── Magic link ──────────────────────────────────────────────────────────────
app.post(
  '/magic-link',
  zValidator(
    'json',
    z.object({
      email: z.string().email(),
      redirect_to: z.string().url().optional(),
    }),
  ),
  async (c) => {
    const { email, redirect_to } = c.req.valid('json');
    const lower = email.toLowerCase();
    const { token, expiresAt } = await issueMagicLink(c.env, lower);
    const verifyUrl = new URL(`${c.env.API_BASE_URL}/auth/magic-link/verify`);
    verifyUrl.searchParams.set('token', token);
    if (redirect_to) verifyUrl.searchParams.set('redirect_to', redirect_to);
    const html = `<p>Sign in to ${escapeHtml(c.env.WEBAUTHN_RP_NAME)}.</p>
      <p><a href="${verifyUrl.toString()}">Tap here to continue</a> — link expires in 15 minutes.</p>
      <p>If you didn't request this, ignore the email.</p>`;
    try {
      await sendEmail(c.env, {
        to: lower,
        subject: `Your sign-in link · ${c.env.WEBAUTHN_RP_NAME}`,
        html,
      });
    } catch (err) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        err instanceof Error ? err.message : 'email send failed',
      );
    }
    return c.json({ ok: true, expires_at: expiresAt });
  },
);

app.get('/magic-link/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) throw new AppError(ErrorCode.BAD_REQUEST, 'missing token');
  const row = await dbQueryOne<{ id: string; email: string; expires_at: number; consumed_at: string | null }>(
    c.env.DB,
    `SELECT id, email, expires_at, consumed_at FROM magic_links WHERE token = ?1`,
    [token],
  );
  if (!row || row.consumed_at || row.expires_at < Date.now()) {
    throw new AppError(ErrorCode.UNAUTHORIZED, 'invalid or expired link');
  }
  await dbExecute(
    c.env.DB,
    `UPDATE magic_links SET consumed_at = ?1, updated_at = ?1 WHERE id = ?2`,
    [new Date().toISOString(), row.id],
  );
  const user = await upsertUser(c.env.DB, { email: row.email, name: null });
  const session = await createSession(c.env, {
    userId: user.id,
    orgId: null,
    ip: c.req.header('cf-connecting-ip') ?? null,
    ua: c.req.header('user-agent') ?? null,
  });
  setSessionCookie(c, session.token);
  await writeAudit(c.env, {
    actor_user_id: user.id,
    actor_email: user.email,
    tenant_id: null,
    event: 'auth.magic_link.success',
    target_type: 'user',
    target_id: user.id,
    metadata: {},
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });
  const redirectTo = c.req.query('redirect_to') ?? c.env.APP_BASE_URL;
  return c.redirect(redirectTo);
});

// ─── Voice OTP ───────────────────────────────────────────────────────────────
app.post(
  '/voice-otp/start',
  zValidator(
    'json',
    z.object({ phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164 phone required') }),
  ),
  async (c) => {
    const { phone } = c.req.valid('json');
    await startVoiceOtp(c.env, phone);
    return c.json({ ok: true });
  },
);

app.post(
  '/voice-otp/verify',
  zValidator(
    'json',
    z.object({
      phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
      code: z.string().min(4).max(10),
      email: z.string().email(),
    }),
  ),
  async (c) => {
    const { phone, code, email } = c.req.valid('json');
    const approved = await checkVoiceOtp(c.env, phone, code);
    if (!approved) throw new AppError(ErrorCode.UNAUTHORIZED, 'OTP rejected');
    const user = await upsertUser(c.env.DB, { email: email.toLowerCase(), name: null, phone });
    const session = await createSession(c.env, {
      userId: user.id,
      orgId: null,
      ip: c.req.header('cf-connecting-ip') ?? null,
      ua: c.req.header('user-agent') ?? null,
    });
    setSessionCookie(c, session.token);
    return c.json({ ok: true, user_id: user.id });
  },
);

// ─── WebAuthn — passkey registration ─────────────────────────────────────────
app.post('/passkey/registration-options', async (c) => {
  const userId = requireAuth(c);
  const user = await dbQueryOne<{ email: string; name: string | null }>(
    c.env.DB,
    `SELECT email, name FROM users WHERE id = ?1`,
    [userId],
  );
  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'user');
  const existing = await c.env.DB.prepare(
    `SELECT credential_id FROM webauthn_credentials WHERE user_id = ?1`,
  )
    .bind(userId)
    .all<{ credential_id: string }>();
  const excludeCredentials = (existing.results ?? []).map((r) => ({
    id: r.credential_id,
    transports: undefined,
  }));
  const options = await generateRegistrationOptions({
    rpID: c.env.WEBAUTHN_RP_ID,
    rpName: c.env.WEBAUTHN_RP_NAME,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    userID: toIsolatedUint8(new TextEncoder().encode(userId)),
    excludeCredentials,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  await dbInsert(c.env.DB, 'webauthn_challenges', {
    id: crypto.randomUUID(),
    user_id: userId,
    challenge: options.challenge,
    expires_at: Date.now() + 5 * 60 * 1000,
  });
  return c.json(options);
});

app.post(
  '/passkey/registration-verify',
  zValidator(
    'json',
    z.object({ response: z.unknown(), challenge: z.string() }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const { response, challenge } = c.req.valid('json');
    const challengeRow = await dbQueryOne<{ id: string; expires_at: number }>(
      c.env.DB,
      `SELECT id, expires_at FROM webauthn_challenges WHERE challenge = ?1 AND user_id = ?2`,
      [challenge, userId],
    );
    if (!challengeRow || challengeRow.expires_at < Date.now()) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'expired challenge');
    }
    const verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: c.env.WEBAUTHN_ORIGIN,
      expectedRPID: c.env.WEBAUTHN_RP_ID,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'webauthn registration not verified');
    }
    const reg = verification.registrationInfo;
    const credential = reg.credential;
    await dbInsert(c.env.DB, 'webauthn_credentials', {
      id: crypto.randomUUID(),
      user_id: userId,
      credential_id: credential.id,
      public_key: bufferToBase64(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ? credential.transports.join(',') : null,
    });
    await dbExecute(c.env.DB, `DELETE FROM webauthn_challenges WHERE id = ?1`, [
      challengeRow.id,
    ]);
    return c.json({ ok: true });
  },
);

app.post(
  '/passkey/authentication-options',
  zValidator('json', z.object({ email: z.string().email().optional() }).default({})),
  async (c) => {
    const options = await generateAuthenticationOptions({
      rpID: c.env.WEBAUTHN_RP_ID,
      userVerification: 'preferred',
    });
    await dbInsert(c.env.DB, 'webauthn_challenges', {
      id: crypto.randomUUID(),
      user_id: null,
      challenge: options.challenge,
      expires_at: Date.now() + 5 * 60 * 1000,
    });
    return c.json(options);
  },
);

app.post(
  '/passkey/authentication-verify',
  zValidator('json', z.object({ response: z.unknown(), challenge: z.string() })),
  async (c) => {
    const { response, challenge } = c.req.valid('json');
    const authResp = response as AuthenticationResponseJSON;
    const credRow = await dbQueryOne<{
      user_id: string;
      public_key: string;
      counter: number;
      transports: string | null;
    }>(
      c.env.DB,
      `SELECT user_id, public_key, counter, transports FROM webauthn_credentials WHERE credential_id = ?1`,
      [authResp.id],
    );
    if (!credRow) throw new AppError(ErrorCode.UNAUTHORIZED, 'unknown credential');
    const verification = await verifyAuthenticationResponse({
      response: authResp,
      expectedChallenge: challenge,
      expectedOrigin: c.env.WEBAUTHN_ORIGIN,
      expectedRPID: c.env.WEBAUTHN_RP_ID,
      credential: {
        id: authResp.id,
        publicKey: toIsolatedUint8(base64ToBuffer(credRow.public_key)),
        counter: credRow.counter,
      },
    });
    if (!verification.verified) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 'webauthn assertion not verified');
    }
    await dbExecute(
      c.env.DB,
      `UPDATE webauthn_credentials SET counter = ?1, updated_at = ?2 WHERE credential_id = ?3`,
      [verification.authenticationInfo.newCounter, new Date().toISOString(), authResp.id],
    );
    const user = await dbQueryOne<{ id: string; email: string }>(
      c.env.DB,
      `SELECT id, email FROM users WHERE id = ?1`,
      [credRow.user_id],
    );
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'user');
    const session = await createSession(c.env, {
      userId: user.id,
      orgId: null,
      ip: c.req.header('cf-connecting-ip') ?? null,
      ua: c.req.header('user-agent') ?? null,
    });
    setSessionCookie(c, session.token);
    return c.json({ ok: true });
  },
);

// ─── TOTP ────────────────────────────────────────────────────────────────────
app.post('/totp/enroll', async (c) => {
  const userId = requireAuth(c);
  // 20-byte secret → base32
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const secret = base32Encode(bytes);
  const issuer = encodeURIComponent(c.env.TOTP_ISSUER);
  const user = await dbQueryOne<{ email: string }>(
    c.env.DB,
    `SELECT email FROM users WHERE id = ?1`,
    [userId],
  );
  if (!user) throw new AppError(ErrorCode.NOT_FOUND, 'user');
  const label = encodeURIComponent(`${c.env.TOTP_ISSUER}:${user.email}`);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  await dbExecute(
    c.env.DB,
    `UPDATE users SET totp_secret = ?1, totp_enabled = 0, updated_at = ?2 WHERE id = ?3`,
    [secret, new Date().toISOString(), userId],
  );
  return c.json({ secret, otpauth_url: otpauth });
});

app.post(
  '/totp/verify',
  zValidator('json', z.object({ code: z.string().regex(/^\d{6}$/) })),
  async (c) => {
    const userId = requireAuth(c);
    const { code } = c.req.valid('json');
    const row = await dbQueryOne<{ totp_secret: string | null }>(
      c.env.DB,
      `SELECT totp_secret FROM users WHERE id = ?1`,
      [userId],
    );
    if (!row || !row.totp_secret) throw new AppError(ErrorCode.BAD_REQUEST, 'no TOTP enrolled');
    const valid = await verifyTotp(row.totp_secret, code);
    if (!valid) throw new AppError(ErrorCode.UNAUTHORIZED, 'invalid code');
    await dbExecute(
      c.env.DB,
      `UPDATE users SET totp_enabled = 1, updated_at = ?1 WHERE id = ?2`,
      [new Date().toISOString(), userId],
    );
    return c.json({ ok: true });
  },
);

// ─── Sign out ────────────────────────────────────────────────────────────────
app.post('/sign-out', async (c) => {
  const auth = c.req.header('authorization');
  const token = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : (c.req.header('cookie') ?? '')
        .split(';')
        .map((p) => p.trim())
        .find((p) => p.startsWith('ps_session='))
        ?.slice('ps_session='.length);
  if (token) await revokeSession(c.env, token);
  deleteCookie(c, 'ps_session', { domain: c.env.COOKIE_DOMAIN, path: '/' });
  return c.json({ ok: true });
});

// ── helpers ──────────────────────────────────────────────────────────────────

function getOAuthCreds(
  env: HonoEnv['Bindings'],
  provider: OAuthProvider,
): { clientId: string; clientSecret: string } {
  if (provider === 'google') {
    return { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET };
  }
  if (provider === 'github') {
    return { clientId: env.GITHUB_OAUTH_CLIENT_ID, clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET };
  }
  if (provider === 'apple') {
    if (!env.APPLE_OAUTH_CLIENT_ID || !env.APPLE_OAUTH_CLIENT_SECRET) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'Apple OAuth not configured');
    }
    return { clientId: env.APPLE_OAUTH_CLIENT_ID, clientSecret: env.APPLE_OAUTH_CLIENT_SECRET };
  }
  if (provider === 'microsoft') {
    if (!env.MICROSOFT_OAUTH_CLIENT_ID || !env.MICROSOFT_OAUTH_CLIENT_SECRET) {
      throw new AppError(ErrorCode.BAD_REQUEST, 'Microsoft OAuth not configured');
    }
    return {
      clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
      clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
    };
  }
  if (!env.FACEBOOK_OAUTH_CLIENT_ID || !env.FACEBOOK_OAUTH_CLIENT_SECRET) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'Facebook OAuth not configured');
  }
  return {
    clientId: env.FACEBOOK_OAUTH_CLIENT_ID,
    clientSecret: env.FACEBOOK_OAUTH_CLIENT_SECRET,
  };
}

async function upsertUser(
  db: D1Database,
  args: { email: string; name: string | null; phone?: string },
): Promise<{ id: string; email: string; name: string | null }> {
  const existing = await dbQueryOne<{ id: string; email: string; name: string | null }>(
    db,
    `SELECT id, email, name FROM users WHERE email = ?1 AND deleted_at IS NULL`,
    [args.email],
  );
  if (existing) return existing;
  const id = crypto.randomUUID();
  await dbInsert(db, 'users', {
    id,
    email: args.email,
    name: args.name,
    totp_enabled: 0,
  });
  return { id, email: args.email, name: args.name };
}

function setSessionCookie(c: Parameters<Hono<HonoEnv>['use']>[0] extends never ? never : any, token: string): void {
  // Hono context (typed in route handler) — we accept loose param to avoid circular import.
  setCookie(c, 'ps_session', token, {
    domain: c.env.COOKIE_DOMAIN,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function bufferToBase64(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

function base64ToBuffer(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** Copy a Uint8Array into a freshly-allocated ArrayBuffer so the TS lib type
 * resolves to `Uint8Array<ArrayBuffer>` (not `ArrayBufferLike`) — required by
 * the SimpleWebAuthn typings under @cloudflare/workers-types. */
function toIsolatedUint8(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(src.byteLength);
  new Uint8Array(buf).set(src);
  return new Uint8Array(buf) as Uint8Array<ArrayBuffer>;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}
function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 5) / 8));
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = BASE32_ALPHABET.indexOf(clean[i]!);
    if (ch < 0) continue;
    value = (value << 5) | ch;
    bits += 5;
    if (bits >= 8) {
      out[idx++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return out.slice(0, idx);
}

async function verifyTotp(secret: string, code: string, step = 30, window = 1): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const counter = Math.floor(Date.now() / 1000 / step);
  for (let offset = -window; offset <= window; offset++) {
    const c = counter + offset;
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, Math.floor(c / 2 ** 32));
    view.setUint32(4, c >>> 0);
    const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
    const off = hmac[hmac.length - 1]! & 0xf;
    const bin =
      ((hmac[off]! & 0x7f) << 24) |
      ((hmac[off + 1]! & 0xff) << 16) |
      ((hmac[off + 2]! & 0xff) << 8) |
      (hmac[off + 3]! & 0xff);
    const otp = (bin % 1_000_000).toString().padStart(6, '0');
    if (otp === code) return true;
  }
  return false;
}

export default app;
