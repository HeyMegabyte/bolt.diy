/**
 * Jobs — list / get / update status / track location. Role-aware: crew sees only
 * jobs assigned to them; customers see only their own job.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { AppError, ErrorCode, type HonoEnv } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import { writeAudit } from '../services/audit.js';
import { MODELS, aiTextCompletion } from '../services/ai-gateway.js';
import { hmacSha256Hex, sha256Hex } from '../services/crypto.js';
import { createProxySession } from '../services/twilio.js';

const app = new Hono<HonoEnv>();

function tenantOrThrow(c: any): string {
  requireAuth(c);
  const tenantId = c.get('tenantId') ?? c.get('orgId');
  if (!tenantId) throw new AppError(ErrorCode.FORBIDDEN, 'tenant required');
  return tenantId;
}

interface JobRow {
  id: string;
  tenant_id: string;
  booking_id: string | null;
  crew_id: string | null;
  customer_id: string | null;
  status: string;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

app.get('/', async (c) => {
  const tenantId = tenantOrThrow(c);
  const userId = c.get('userId')!;
  const viewAs = c.get('viewAs');
  let rows: JobRow[];
  if (viewAs === 'crew') {
    rows = await dbQuery<JobRow>(
      c.env.DB,
      `SELECT * FROM jobs WHERE tenant_id = ?1 AND crew_id = ?2 AND deleted_at IS NULL ORDER BY scheduled_for ASC LIMIT 200`,
      [tenantId, userId],
    );
  } else if (viewAs === 'customer') {
    rows = await dbQuery<JobRow>(
      c.env.DB,
      `SELECT * FROM jobs WHERE tenant_id = ?1 AND customer_id = ?2 AND deleted_at IS NULL ORDER BY scheduled_for ASC LIMIT 200`,
      [tenantId, userId],
    );
  } else {
    rows = await dbQuery<JobRow>(
      c.env.DB,
      `SELECT * FROM jobs WHERE tenant_id = ?1 AND deleted_at IS NULL ORDER BY scheduled_for ASC LIMIT 200`,
      [tenantId],
    );
  }
  return c.json({ jobs: rows });
});

app.get('/:id', async (c) => {
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');
  const row = await dbQueryOne<JobRow>(
    c.env.DB,
    `SELECT * FROM jobs WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'job');
  return c.json(row);
});

app.patch(
  '/:id/status',
  zValidator(
    'json',
    z.object({
      status: z.enum(['scheduled', 'en_route', 'on_site', 'completed', 'cancelled', 'delayed']),
      note: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const id = c.req.param('id');
    const { status, note } = c.req.valid('json');
    await dbExecute(
      c.env.DB,
      `UPDATE jobs SET status = ?1, updated_at = ?2 WHERE id = ?3 AND tenant_id = ?4`,
      [status, new Date().toISOString(), id, tenantId],
    );
    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: `job.status.${status}`,
      target_type: 'job',
      target_id: id,
      metadata: { note: note ?? null },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    // Fan out to JobTrackingHub so the customer's map updates live.
    const stub = c.env.JOB_TRACKING_HUB.get(c.env.JOB_TRACKING_HUB.idFromName(`${tenantId}:${id}`));
    c.executionCtx.waitUntil(
      stub.fetch('https://do/ping', {
        method: 'POST',
        body: JSON.stringify({ ts: Date.now(), lat: 0, lng: 0, status }),
      }),
    );
    return c.json({ ok: true });
  },
);

app.post(
  '/:id/ping',
  zValidator(
    'json',
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      heading: z.number().optional(),
      speed_mps: z.number().optional(),
      status: z.string().optional(),
      eta_seconds: z.number().int().optional(),
    }),
  ),
  async (c) => {
    requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const stub = c.env.JOB_TRACKING_HUB.get(c.env.JOB_TRACKING_HUB.idFromName(`${tenantId}:${id}`));
    await stub.fetch('https://do/ping', {
      method: 'POST',
      body: JSON.stringify({ ts: Date.now(), ...body }),
    });
    return c.json({ ok: true });
  },
);

// ── #19 GPS+EXIF photo verification ────────────────────────────────────────
/**
 * POST /api/jobs/:id/photo-verify
 *
 * Client captures a photo via Capacitor, extracts EXIF GPS+timestamp, computes
 * a SHA-256 hash of the raw bytes, then uploads to R2 (separately) and posts
 * the receipt here. Server signs `r2_key|hash|captured_at|gps` with HMAC-SHA-256
 * using SESSION_SECRET, producing a legal-grade chain-of-custody record.
 */
app.post(
  '/:id/photo-verify',
  zValidator(
    'json',
    z.object({
      r2_key: z.string().min(1).max(512),
      hash: z
        .string()
        .regex(/^[0-9a-f]{64}$/i, 'hash must be sha-256 hex')
        .transform((s) => s.toLowerCase()),
      captured_at: z.string().datetime(),
      gps: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          accuracy_m: z.number().nonnegative().optional(),
        })
        .optional(),
      exif: z.record(z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const id = c.req.param('id');
    const body = c.req.valid('json');

    const job = await dbQueryOne<{ id: string }>(
      c.env.DB,
      `SELECT id FROM jobs WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
      [id, tenantId],
    );
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'job');

    const serverSignedAt = new Date().toISOString();
    const gpsPart = body.gps
      ? `${body.gps.lat.toFixed(6)},${body.gps.lng.toFixed(6)}`
      : '';
    const payload = `${body.r2_key}|${body.hash}|${body.captured_at}|${gpsPart}|${serverSignedAt}`;
    const serverSignature = await hmacSha256Hex(c.env.SESSION_SECRET, payload);

    const photoId = crypto.randomUUID();
    await dbInsert(c.env.DB, 'job_photos', {
      id: photoId,
      tenant_id: tenantId,
      job_id: id,
      uploader_user_id: userId,
      r2_key: body.r2_key,
      client_hash: body.hash,
      gps_lat: body.gps?.lat ?? null,
      gps_lng: body.gps?.lng ?? null,
      gps_accuracy_m: body.gps?.accuracy_m ?? null,
      captured_at: body.captured_at,
      server_signed_at: serverSignedAt,
      server_signature: serverSignature,
      exif_json: body.exif ? JSON.stringify(body.exif) : null,
    });

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'job.photo.verified',
      target_type: 'job_photo',
      target_id: photoId,
      metadata: {
        job_id: id,
        r2_key: body.r2_key,
        has_gps: body.gps != null,
      },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({
      photo_id: photoId,
      server_signature: serverSignature,
      server_signed_at: serverSignedAt,
    });
  },
);

// ── #25 Twilio voice-masking call ──────────────────────────────────────────
/**
 * POST /api/jobs/:id/call
 *
 * Mints a Twilio Proxy session that masks customer ↔ crew phone numbers
 * behind a single Twilio proxy number. Returns the session URL the UI can
 * dial / link to. Session expires 2 hours from creation.
 */
app.post('/:id/call', async (c) => {
  const userId = requireAuth(c);
  const tenantId = tenantOrThrow(c);
  const id = c.req.param('id');

  const job = await dbQueryOne<{
    customer_id: string | null;
    crew_id: string | null;
  }>(
    c.env.DB,
    `SELECT customer_id, crew_id FROM jobs WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
    [id, tenantId],
  );
  if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'job');
  if (!job.customer_id || !job.crew_id) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'job missing customer or crew assignment');
  }

  const phones = await dbQuery<{ user_id: string; phone: string | null }>(
    c.env.DB,
    `SELECT id AS user_id, COALESCE(phone, '') AS phone FROM users WHERE id IN (?1, ?2)`,
    [job.customer_id, job.crew_id],
  );
  const customer = phones.find((p) => p.user_id === job.customer_id);
  const crew = phones.find((p) => p.user_id === job.crew_id);
  if (!customer?.phone || !crew?.phone) {
    throw new AppError(ErrorCode.BAD_REQUEST, 'customer or crew phone not on file');
  }

  const expiresAtMs = Date.now() + 1000 * 60 * 60 * 2;
  const session = await createProxySession(c.env, {
    participants: [customer.phone, crew.phone],
    expiresAtMs,
    uniqueName: `job:${id}:${Date.now()}`,
  });

  await writeAudit(c.env, {
    actor_user_id: userId,
    actor_email: c.get('userEmail'),
    tenant_id: tenantId,
    event: 'job.voice.mask',
    target_type: 'twilio_proxy_session',
    target_id: session.session_sid,
    metadata: { job_id: id, expires_at_ms: expiresAtMs },
    ip: c.req.header('cf-connecting-ip') ?? null,
    user_agent: c.req.header('user-agent') ?? null,
  });

  const masked = session.masked_numbers[0]?.proxy_identifier ?? '';
  return c.json({
    session_sid: session.session_sid,
    masked_number: masked,
    twilio_session_url: `https://proxy.twilio.com/v1/Sessions/${session.session_sid}`,
    expires_at: new Date(expiresAtMs).toISOString(),
  });
});

// ── #18 EN↔ES chat message translation ─────────────────────────────────────
// POST /api/jobs/:jobId/translate — Workers AI Llama 3.3 70B translates the
// message into `target_lang`. Result cached per (job, source-hash, target-lang)
// in the `chat_translations` table so toggling the UI off/on is free.

const TRANSLATE_SYSTEM =
  'You are a translator. Output ONLY the translated text, no preamble, no ' +
  'explanation, no quotes. Preserve emoji + punctuation. If the source is ' +
  'already in the target language, return it unchanged.';

app.post(
  '/:jobId/translate',
  zValidator(
    'json',
    z.object({
      text: z.string().min(1).max(4_000),
      target_lang: z
        .string()
        .min(2)
        .max(8)
        .regex(/^[a-z]{2}(-[A-Z]{2})?$/),
    }),
  ),
  async (c) => {
    const userId = requireAuth(c);
    const tenantId = tenantOrThrow(c);
    const jobId = c.req.param('jobId');
    const { text, target_lang } = c.req.valid('json');

    // Authorize: job must belong to caller's tenant.
    const job = await dbQueryOne<{ id: string }>(
      c.env.DB,
      `SELECT id FROM jobs WHERE id = ?1 AND tenant_id = ?2 AND deleted_at IS NULL`,
      [jobId, tenantId],
    );
    if (!job) throw new AppError(ErrorCode.NOT_FOUND, 'job');

    const source_hash = await sha256Hex(text);

    // Cache hit?
    const existing = await dbQueryOne<{ translated_text: string; model: string }>(
      c.env.DB,
      `SELECT translated_text, model FROM chat_translations
       WHERE job_id = ?1 AND source_hash = ?2 AND target_lang = ?3`,
      [jobId, source_hash, target_lang],
    );
    if (existing) {
      return c.json({
        translated_text: existing.translated_text,
        target_lang,
        model: existing.model,
        cached: true,
      });
    }

    const translated_text = (
      await aiTextCompletion(c.env, {
        system: TRANSLATE_SYSTEM,
        user: `Translate to ${target_lang}: ${text}`,
        max_tokens: 800,
      })
    )
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim();

    await dbInsert(c.env.DB, 'chat_translations', {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      job_id: jobId,
      source_hash,
      target_lang,
      source_text: text,
      translated_text,
      model: MODELS.LLAMA_3_3_70B,
    });

    await writeAudit(c.env, {
      actor_user_id: userId,
      actor_email: c.get('userEmail'),
      tenant_id: tenantId,
      event: 'ai.chat_translate',
      target_type: 'job',
      target_id: jobId,
      metadata: { target_lang, source_len: text.length, out_len: translated_text.length },
      ip: c.req.header('cf-connecting-ip') ?? null,
      user_agent: c.req.header('user-agent') ?? null,
    });

    return c.json({
      translated_text,
      target_lang,
      model: MODELS.LLAMA_3_3_70B,
      cached: false,
    });
  },
);

export default app;
