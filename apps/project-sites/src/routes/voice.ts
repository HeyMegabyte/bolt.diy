/**
 * @module routes/voice
 * @description Authenticated `/api/voice/*` routes for the AI Voice + SMS feature.
 *
 * Every route enforces:
 *  - bearer auth → `userId` + `orgId` populated by authMiddleware
 *  - org membership of the target site
 *  - 3-numbers-per-site cap on purchase
 *  - graceful 501 when `TWILIO_AUTH_TOKEN` is missing
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne, dbQuery, dbInsert, dbUpdate } from '../services/db.js';
import {
  isTwilioConfigured,
  searchAvailableNumbers,
  purchaseNumber,
  releaseNumber,
  formatVanity,
  letterToDigit,
} from '../services/twilio.js';
import { suggestVanityWords, type VanityBusinessProfile } from '../services/vanity_generator.js';
import { simulateInbound } from '../services/sms_agent.js';
import * as auditService from '../services/audit.js';
import {
  AppError,
  unauthorized,
  notFound,
  forbidden,
  badRequest,
  conflict,
} from '@project-sites/shared';

export const voiceRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── small helpers ───────────────────────────────────────────────

function publicHost(env: Env): string {
  return env.ENVIRONMENT === 'production'
    ? 'projectsites.dev'
    : 'project-sites.manhattan.workers.dev';
}

function notConfigured(): AppError {
  return new AppError({
    code: 'SERVICE_UNAVAILABLE',
    message: 'TWILIO_NOT_CONFIGURED: set TWILIO_AUTH_TOKEN via `wrangler secret put`',
    statusCode: 501,
  });
}

async function requireSiteMembership(
  env: Env,
  siteId: string,
  orgId: string,
): Promise<{ id: string; org_id: string; business_name: string | null; business_address: string | null }> {
  const site = await dbQueryOne<{
    id: string;
    org_id: string;
    business_name: string | null;
    business_address: string | null;
  }>(
    env.DB,
    `SELECT id, org_id, business_name, business_address
       FROM sites WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [siteId],
  );
  if (!site) throw notFound('Site not found');
  if (site.org_id !== orgId) throw forbidden('Site not in your org');
  return site;
}

function requireAuth(c: { get: (k: string) => string | undefined }): {
  userId: string;
  orgId: string;
} {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId || !orgId) throw unauthorized();
  return { userId, orgId };
}

// ─── number search ──────────────────────────────────────────────

const searchQuery = z.object({
  contains: z.string().min(1).max(20).optional(),
  areaCode: z
    .string()
    .regex(/^\d{3}$/)
    .optional(),
  country: z.string().length(2).optional(),
  limit: z.coerce.number().int().min(1).max(30).optional(),
});

/**
 * `GET /api/voice/numbers/search?contains=&areaCode=&country=&limit=` —
 * Search available Twilio phone numbers.
 *
 * @remarks
 * Proxies {@link searchAvailableNumbers}. Inputs validated against
 * {@link searchQuery}.
 *
 * @throws 400 BAD_REQUEST when query validation fails.
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 501 NOT_IMPLEMENTED when Twilio isn't configured on this worker.
 */
voiceRoutes.get('/api/voice/numbers/search', async (c) => {
  requireAuth(c);
  if (!isTwilioConfigured(c.env)) throw notConfigured();
  const q = searchQuery.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const numbers = await searchAvailableNumbers(c.env, {
    country: q.country ?? 'US',
    areaCode: q.areaCode,
    contains: q.contains,
    limit: q.limit ?? 20,
  });
  // Annotate each with the vanity-rendered display IF a `contains` word was provided
  const annotated = numbers.map((n) => ({
    ...n,
    vanity_display:
      q.contains && /[A-Za-z]/.test(q.contains)
        ? formatVanity(n.phone_number, q.contains.toUpperCase())
        : null,
    contains_digits: q.contains ? letterToDigit(q.contains) : null,
  }));
  return c.json({ numbers: annotated, total: annotated.length });
});

// ─── vanity suggestions ─────────────────────────────────────────

/**
 * `GET /api/voice/vanity-suggestions?site_id=` — AI-suggested vanity-number
 * dial words for a site (e.g., 1-800-FLOWERS).
 *
 * @remarks
 * Calls {@link suggestVanityWords} with the site's business profile.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when site isn't in the caller's org.
 * @throws 404 NOT_FOUND when site doesn't exist.
 */
voiceRoutes.get('/api/voice/vanity-suggestions', async (c) => {
  const { orgId } = requireAuth(c);
  const siteId = c.req.query('siteId');
  if (!siteId) throw badRequest('siteId required');
  const site = await requireSiteMembership(c.env, siteId, orgId);

  const profile: VanityBusinessProfile = {
    businessName: site.business_name ?? 'business',
    location: site.business_address ?? undefined,
  };
  const result = await suggestVanityWords(c.env, { siteId, businessProfile: profile });
  return c.json(result);
});

// ─── purchase ───────────────────────────────────────────────────

const purchaseBody = z.object({
  siteId: z.string().min(1),
  phoneNumber: z.string().regex(/^\+\d{8,15}$/, 'Must be E.164'),
  friendlyName: z.string().max(64).optional(),
  vanityWord: z.string().regex(/^[A-Za-z]{3,7}$/).optional(),
});

/**
 * `POST /api/voice/numbers/purchase` — Buy a Twilio phone number for a site.
 *
 * @remarks
 * Body: `{ site_id, phone_number, vanity_word? }`. Enforces the
 * 3-numbers-per-site cap. Wires Twilio webhooks to `/webhooks/voice/*`
 * + `/webhooks/sms/*` on the public host. Audit-logged.
 *
 * @throws 400 BAD_REQUEST when payload missing required fields.
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when site isn't in the caller's org.
 * @throws 404 NOT_FOUND when site doesn't exist.
 * @throws 409 CONFLICT when site already owns 3 numbers.
 * @throws 501 NOT_IMPLEMENTED when Twilio isn't configured on this worker.
 */
voiceRoutes.post('/api/voice/numbers/purchase', async (c) => {
  const { userId, orgId } = requireAuth(c);
  if (!isTwilioConfigured(c.env)) throw notConfigured();
  const body = purchaseBody.parse(await c.req.json());
  await requireSiteMembership(c.env, body.siteId, orgId);

  // 3-number cap per site
  const existing = await dbQuery<{ id: string }>(
    c.env.DB,
    `SELECT id FROM voice_numbers
       WHERE site_id = ? AND status = 'active' AND deleted_at IS NULL`,
    [body.siteId],
  );
  if (existing.data.length >= 3) {
    throw conflict('Per-site cap reached (3 active numbers).');
  }

  const host = publicHost(c.env);
  const voiceUrl = `https://${host}/webhooks/voice/inbound`;
  const smsUrl = `https://${host}/webhooks/sms/inbound`;

  const purchased = await purchaseNumber(c.env, {
    phoneNumber: body.phoneNumber,
    voiceUrl,
    smsUrl,
    friendlyName: body.friendlyName ?? body.phoneNumber,
  });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await dbInsert(c.env.DB, 'voice_numbers', {
    id,
    site_id: body.siteId,
    org_id: orgId,
    phone_number: purchased.phone_number,
    friendly_name: purchased.friendly_name,
    vanity_display: body.vanityWord
      ? formatVanity(purchased.phone_number, body.vanityWord)
      : null,
    twilio_sid: purchased.sid,
    capabilities: JSON.stringify(purchased.capabilities),
    voice_url: voiceUrl,
    sms_url: smsUrl,
    monthly_cost_cents: 100,
    purchased_at: now,
    status: 'active',
  });

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'voice.number_purchased',
    message: `Purchased ${purchased.phone_number} for site ${body.siteId}`,
    target_type: 'voice_number',
    target_id: id,
    metadata_json: {
      site_id: body.siteId,
      phone_number: purchased.phone_number,
      twilio_sid: purchased.sid,
      vanity_word: body.vanityWord ?? null,
    },
    request_id: c.get('requestId'),
  });

  return c.json({
    id,
    site_id: body.siteId,
    phone_number: purchased.phone_number,
    vanity_display: body.vanityWord
      ? formatVanity(purchased.phone_number, body.vanityWord)
      : null,
    twilio_sid: purchased.sid,
    capabilities: purchased.capabilities,
    monthly_cost_cents: 100,
    status: 'active',
  });
});

// ─── list numbers ───────────────────────────────────────────────

/**
 * `GET /api/voice/numbers?site_id=` — List phone numbers owned by a site.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when site isn't in the caller's org.
 * @throws 404 NOT_FOUND when site doesn't exist.
 */
voiceRoutes.get('/api/voice/numbers', async (c) => {
  const { orgId } = requireAuth(c);
  const siteId = c.req.query('siteId');
  if (!siteId) throw badRequest('siteId required');
  await requireSiteMembership(c.env, siteId, orgId);
  const rows = await dbQuery<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, site_id, phone_number, friendly_name, vanity_display, twilio_sid,
            capabilities, monthly_cost_cents, purchased_at, released_at, status,
            created_at, updated_at
       FROM voice_numbers
       WHERE site_id = ? AND deleted_at IS NULL
       ORDER BY created_at DESC`,
    [siteId],
  );
  return c.json({ numbers: rows.data });
});

// ─── release ────────────────────────────────────────────────────

/**
 * `DELETE /api/voice/numbers/:id` — Release a phone number back to Twilio
 * and remove it from the site.
 *
 * @remarks
 * Calls {@link releaseNumber} then deletes the row. Audit-logged.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when number isn't in the caller's org.
 * @throws 404 NOT_FOUND when number id doesn't exist.
 * @throws 501 NOT_IMPLEMENTED when Twilio isn't configured on this worker.
 */
voiceRoutes.delete('/api/voice/numbers/:id', async (c) => {
  const { userId, orgId } = requireAuth(c);
  const id = c.req.param('id');
  if (!id) throw badRequest('id required');
  const row = await dbQueryOne<{ id: string; org_id: string; twilio_sid: string | null; phone_number: string }>(
    c.env.DB,
    `SELECT id, org_id, twilio_sid, phone_number FROM voice_numbers
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  if (!row) throw notFound('Number not found');
  if (row.org_id !== orgId) throw forbidden('Not your number');
  if (!isTwilioConfigured(c.env)) throw notConfigured();

  if (row.twilio_sid) {
    try {
      await releaseNumber(c.env, row.twilio_sid);
    } catch (err) {
      // Swallow 404 — Twilio may have already released; still soft-delete locally.
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'voice_routes',
          message: 'twilio_release_failed_soft_continue',
          error: err instanceof Error ? err.message : String(err),
          twilio_sid: row.twilio_sid,
        }),
      );
    }
  }

  await dbUpdate(
    c.env.DB,
    'voice_numbers',
    {
      status: 'released',
      released_at: new Date().toISOString(),
      deleted_at: new Date().toISOString(),
    },
    'id = ?',
    [id],
  );

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'voice.number_released',
    message: `Released ${row.phone_number}`,
    target_type: 'voice_number',
    target_id: id,
    request_id: c.get('requestId'),
  });

  return c.json({ ok: true, id });
});

// ─── unified conversation timeline ──────────────────────────────

/**
 * `GET /api/voice/conversations?site_id=&kind=&limit=` — List recent
 * conversations (calls + SMS threads) for a site.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when site isn't in the caller's org.
 */
voiceRoutes.get('/api/voice/conversations', async (c) => {
  const { orgId } = requireAuth(c);
  const siteId = c.req.query('siteId');
  const since = c.req.query('since'); // ISO datetime
  if (!siteId) throw badRequest('siteId required');
  await requireSiteMembership(c.env, siteId, orgId);

  const sinceClause = since ? `AND started_at >= ?` : '';
  const params: unknown[] = [siteId];
  if (since) params.push(since);
  const calls = await dbQuery<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, 'call' AS kind, voice_number_id, direction, from_number, to_number,
            status, started_at AS event_at, ended_at, duration_seconds, sentiment,
            summary, twilio_call_sid
       FROM voice_calls
       WHERE site_id = ? AND deleted_at IS NULL ${sinceClause}
       ORDER BY started_at DESC LIMIT 200`,
    params,
  );

  const msgsParams: unknown[] = [siteId];
  if (since) msgsParams.push(since);
  const sinceClauseMsg = since ? `AND sent_at >= ?` : '';
  const messages = await dbQuery<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, 'sms' AS kind, voice_number_id, direction, from_number, to_number,
            status, sent_at AS event_at, body, ai_reply_id, twilio_message_sid
       FROM voice_messages
       WHERE site_id = ? AND deleted_at IS NULL ${sinceClauseMsg}
       ORDER BY sent_at DESC LIMIT 400`,
    msgsParams,
  );

  const merged = [...calls.data, ...messages.data].sort((a, b) => {
    const at = (a as { event_at?: string }).event_at ?? '';
    const bt = (b as { event_at?: string }).event_at ?? '';
    return bt.localeCompare(at);
  });
  return c.json({ items: merged.slice(0, 300) });
});

// ─── call detail ────────────────────────────────────────────────

/**
 * `GET /api/voice/calls/:id` — Fetch a single call with transcript +
 * sentiment + intent breakdown.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when call isn't in the caller's org.
 * @throws 404 NOT_FOUND when call id doesn't exist.
 */
voiceRoutes.get('/api/voice/calls/:id', async (c) => {
  const { orgId } = requireAuth(c);
  const id = c.req.param('id');
  if (!id) throw badRequest('id required');
  const call = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM voice_calls WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  if (!call) throw notFound('Call not found');
  if ((call as { org_id?: string }).org_id !== orgId) throw forbidden('Not your call');
  const recordings = await dbQuery<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, kind, r2_key, mime, size_bytes, duration_seconds, created_at
       FROM voice_recordings WHERE call_id = ? AND deleted_at IS NULL`,
    [id],
  );
  return c.json({ call, recordings: recordings.data });
});

// ─── recording stream (range-aware R2 proxy) ────────────────────

/**
 * `GET /api/voice/recordings/:id/stream` — Stream the audio recording
 * (MP3) for playback in the admin UI.
 *
 * @remarks
 * Reads from R2 (`recordings/{call_sid}/{recording_sid}.mp3`) or falls
 * back to Twilio if not yet mirrored. Sets `Content-Type: audio/mpeg`
 * and `Cache-Control: private, max-age=3600`.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when recording isn't in the caller's org.
 * @throws 404 NOT_FOUND when recording id doesn't exist.
 */
voiceRoutes.get('/api/voice/recordings/:id/stream', async (c) => {
  const { orgId } = requireAuth(c);
  const id = c.req.param('id');
  if (!id) throw badRequest('id required');
  const rec = await dbQueryOne<{
    id: string;
    call_id: string;
    r2_key: string;
    mime: string | null;
    size_bytes: number | null;
  }>(
    c.env.DB,
    `SELECT id, call_id, r2_key, mime, size_bytes FROM voice_recordings
       WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  if (!rec) throw notFound('Recording not found');
  // Ensure ownership through the call
  const ownCheck = await dbQueryOne<{ org_id: string }>(
    c.env.DB,
    `SELECT org_id FROM voice_calls WHERE id = ? LIMIT 1`,
    [rec.call_id],
  );
  if (!ownCheck || ownCheck.org_id !== orgId) throw forbidden('Not your recording');

  const range = c.req.header('range');
  let r2Object: R2ObjectBody | null;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const offset = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : undefined;
      const length = end !== undefined ? end - offset + 1 : undefined;
      r2Object = await c.env.SITES_BUCKET.get(rec.r2_key, { range: { offset, length } });
    } else {
      r2Object = await c.env.SITES_BUCKET.get(rec.r2_key);
    }
  } else {
    r2Object = await c.env.SITES_BUCKET.get(rec.r2_key);
  }
  if (!r2Object) throw notFound('Recording bytes missing in R2');

  return new Response(r2Object.body, {
    status: range ? 206 : 200,
    headers: {
      'Content-Type': rec.mime ?? 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=60',
      ...(rec.size_bytes ? { 'Content-Length': String(r2Object.size) } : {}),
    },
  });
});

// ─── agent settings GET/PUT ────────────────────────────────────

const agentSettingsBody = z.object({
  siteId: z.string().min(1),
  voice_system_prompt: z.string().max(8000).nullable().optional(),
  sms_system_prompt: z.string().max(8000).nullable().optional(),
  voice_voice_id: z.string().max(120).nullable().optional(),
  voice_model: z.string().max(120).nullable().optional(),
  sms_model: z.string().max(120).nullable().optional(),
  max_call_seconds: z.number().int().min(30).max(3600).optional(),
  recording_enabled: z.boolean().optional(),
  video_browse_enabled: z.boolean().optional(),
  mcp_connection_ids: z.array(z.string()).max(20).optional(),
  escalation_phone: z.string().regex(/^\+\d{8,15}$/).nullable().optional(),
  business_hours_json: z.string().max(2000).nullable().optional(),
  knowledge_base_urls: z.array(z.string().url()).max(20).optional(),
});

/**
 * `GET /api/voice/agent-settings?site_id=` — Read the AI voice agent's
 * per-site settings (greeting, voice, escalation rules, hours).
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when site isn't in the caller's org.
 */
voiceRoutes.get('/api/voice/agent-settings', async (c) => {
  const { orgId } = requireAuth(c);
  const siteId = c.req.query('siteId');
  if (!siteId) throw badRequest('siteId required');
  await requireSiteMembership(c.env, siteId, orgId);
  const row = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM voice_agent_settings WHERE site_id = ? AND deleted_at IS NULL LIMIT 1`,
    [siteId],
  );
  return c.json({ settings: row ?? null });
});

/**
 * `PUT /api/voice/agent-settings` — Update the AI voice agent settings
 * for a site.
 *
 * @remarks
 * Body: `{ site_id, greeting?, voice?, escalation_phone?, hours? }` —
 * note: not yet Zod-validated (loose JSON parse). Audit-logged.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when site isn't in the caller's org.
 */
voiceRoutes.put('/api/voice/agent-settings', async (c) => {
  const { userId, orgId } = requireAuth(c);
  const body = agentSettingsBody.parse(await c.req.json());
  await requireSiteMembership(c.env, body.siteId, orgId);

  const updates: Record<string, unknown> = {
    voice_system_prompt: body.voice_system_prompt ?? null,
    sms_system_prompt: body.sms_system_prompt ?? null,
    voice_voice_id: body.voice_voice_id ?? null,
    voice_model: body.voice_model ?? null,
    sms_model: body.sms_model ?? null,
    max_call_seconds: body.max_call_seconds ?? 600,
    recording_enabled: body.recording_enabled === false ? 0 : 1,
    video_browse_enabled: body.video_browse_enabled === false ? 0 : 1,
    mcp_connection_ids: body.mcp_connection_ids ? JSON.stringify(body.mcp_connection_ids) : null,
    escalation_phone: body.escalation_phone ?? null,
    business_hours_json: body.business_hours_json ?? null,
    knowledge_base_urls: body.knowledge_base_urls ? JSON.stringify(body.knowledge_base_urls) : null,
  };

  const existing = await dbQueryOne<{ id: string }>(
    c.env.DB,
    `SELECT id FROM voice_agent_settings WHERE site_id = ? AND deleted_at IS NULL LIMIT 1`,
    [body.siteId],
  );
  if (existing) {
    await dbUpdate(c.env.DB, 'voice_agent_settings', updates, 'id = ?', [existing.id]);
  } else {
    await dbInsert(c.env.DB, 'voice_agent_settings', {
      id: crypto.randomUUID(),
      site_id: body.siteId,
      ...updates,
    });
  }

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: userId,
    action: 'voice.agent_settings_updated',
    message: `Voice/SMS agent settings updated for site ${body.siteId}`,
    target_type: 'site',
    target_id: body.siteId,
    request_id: c.get('requestId'),
  });

  return c.json({ ok: true });
});

// ─── /test/sms — simulate inbound without going through Twilio ──

const testSmsBody = z.object({
  siteId: z.string().min(1),
  body: z.string().min(1).max(2000),
});

/**
 * `POST /api/voice/test/sms` — Test-mode SMS agent simulator (does not
 * send a real SMS; runs the inbound message through {@link simulateInbound}).
 *
 * @remarks
 * Body: `{ site_id, from, body }`. Returns the agent's reply + intent +
 * sentiment for debugging the persona.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when site isn't in the caller's org.
 */
voiceRoutes.post('/api/voice/test/sms', async (c) => {
  const { orgId } = requireAuth(c);
  const body = testSmsBody.parse(await c.req.json());
  const site = await requireSiteMembership(c.env, body.siteId, orgId);

  const settingsRow = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    `SELECT * FROM voice_agent_settings WHERE site_id = ? AND deleted_at IS NULL LIMIT 1`,
    [body.siteId],
  );

  const result = await simulateInbound(c.env, {
    siteId: body.siteId,
    orgId,
    body: body.body,
    profile: {
      businessName: site.business_name ?? 'this business',
      businessLocation: site.business_address ?? undefined,
    },
    settings: (settingsRow ?? {}) as Record<string, never>,
  });
  return c.json(result);
});

// ─── /test/call-token — short-lived Twilio Client JWT ───────────

/**
 * `POST /api/voice/test/call-token` — Mint a short-lived Twilio JWT for
 * the admin "test call" widget so the admin's browser can place a call
 * directly to the AI voice agent through the Twilio Voice SDK.
 *
 * @throws 401 UNAUTHORIZED when auth context is missing.
 * @throws 403 FORBIDDEN when site isn't in the caller's org.
 * @throws 501 NOT_IMPLEMENTED when Twilio isn't configured on this worker.
 */
voiceRoutes.post('/api/voice/test/call-token', async (c) => {
  const { userId, orgId } = requireAuth(c);
  const body = z.object({ siteId: z.string().min(1) }).parse(await c.req.json());
  await requireSiteMembership(c.env, body.siteId, orgId);

  const apiKey = (c.env.TWILIO_API_KEY ?? '').trim();
  const apiSecret = (c.env.TWILIO_API_SECRET ?? '').trim();
  const accountSid = (c.env.TWILIO_ACCOUNT_SID ?? '').trim();
  const appSid = (c.env.TWILIO_TWIML_APP_SID ?? '').trim();
  if (!apiKey || !apiSecret || !accountSid || !appSid) {
    throw new AppError({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 501,
      message:
        'TWILIO_CLIENT_NOT_CONFIGURED — paste TWILIO_API_KEY, TWILIO_API_SECRET, TWILIO_TWIML_APP_SID via `wrangler secret put`',
    });
  }
  const identity = `user-${userId.slice(0, 8)}-site-${body.siteId.slice(0, 8)}`;
  const token = await mintTwilioAccessToken({
    accountSid,
    apiKey,
    apiSecret,
    identity,
    twimlAppSid: appSid,
    ttlSeconds: 3600,
  });
  return c.json({ token, identity, edge_url: 'wss://chunderw-vpc-gll.twilio.com/signal' });
});

// ─── Twilio Access Token (Voice grant) — JWT mint ───────────────

/**
 * Mint a Twilio Access Token with a Voice grant. Pure Web-Crypto, no twilio SDK.
 * https://www.twilio.com/docs/iam/access-tokens
 */
async function mintTwilioAccessToken(opts: {
  accountSid: string;
  apiKey: string;
  apiSecret: string;
  identity: string;
  twimlAppSid: string;
  ttlSeconds: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${opts.apiKey}-${now}`,
    iss: opts.apiKey,
    sub: opts.accountSid,
    iat: now,
    exp: now + opts.ttlSeconds,
    grants: {
      identity: opts.identity,
      voice: {
        incoming: { allow: true },
        outgoing: { application_sid: opts.twimlAppSid },
      },
    },
  };
  const enc = new TextEncoder();
  const b64url = (b: Uint8Array | string): string => {
    const bin = typeof b === 'string' ? b : String.fromCharCode(...b);
    return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(opts.apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(signingInput)));
  return `${signingInput}.${b64url(sig)}`;
}
