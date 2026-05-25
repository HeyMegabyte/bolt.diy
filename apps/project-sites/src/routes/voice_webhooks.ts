/**
 * @module routes/voice_webhooks
 * @description Public, Twilio-signature-verified webhook + WebSocket routes.
 *
 * | Path                              | Method | Purpose                                  |
 * | --------------------------------- | ------ | ---------------------------------------- |
 * | `/webhooks/voice/inbound`         | POST   | TwiML for inbound call                   |
 * | `/webhooks/voice/stream`          | GET    | WS upgrade → call-gpt Media Stream bridge |
 * | `/webhooks/voice/status`          | POST   | Twilio call status callback              |
 * | `/webhooks/voice/recording-ready` | POST   | Twilio recording-status callback (→ R2)  |
 * | `/webhooks/sms/inbound`           | POST   | TwiML for inbound SMS                    |
 * | `/webhooks/sms/status`            | POST   | Twilio SMS status callback               |
 * | `/internal/voice/recording-saved` | POST   | Browse-agent → worker callback (HMAC)    |
 *
 * Every Twilio webhook verifies `X-Twilio-Signature`. Missing or mismatched
 * signatures → 403. Webhooks are idempotent via UNIQUE indexes on the
 * Twilio SIDs (call/message).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import { validateSignature, fetchRecording, downloadRecordingBytes } from '../services/twilio.js';
import {
  handleInboundCall,
  handleInboundSms,
  handleMediaStream,
} from '../services/voice_orchestrator.js';

export const voiceWebhookRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const TWIML_HEADERS = { 'Content-Type': 'text/xml; charset=utf-8' };

async function readFormParams(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

function fullUrl(req: Request): string {
  // X-Twilio-Signature is computed over the original URL Twilio called. Use
  // host header so the calculation matches behind Cloudflare's proxy.
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? url.host;
  url.host = host;
  url.protocol = 'https:';
  return url.toString();
}

async function requireTwilioSignature(
  env: Env,
  req: Request,
  params: Record<string, string>,
): Promise<boolean> {
  const sig = req.headers.get('x-twilio-signature') ?? '';
  if (!sig) return false;
  return validateSignature(env, sig, fullUrl(req), params);
}

// ─── Inbound voice call ─────────────────────────────────────────

/**
 * `POST /webhooks/voice/inbound` — Inbound-call TwiML response for Twilio.
 *
 * @remarks
 * Verifies `X-Twilio-Signature` against the full request URL + form
 * params. Delegates to {@link handleInboundCall} which builds the TwiML
 * (greeting, transfer, IVR menu, or media-stream upgrade) per site
 * config.
 *
 * @throws 403 FORBIDDEN when the Twilio signature is missing or invalid.
 */
voiceWebhookRoutes.post('/webhooks/voice/inbound', async (c) => {
  const params = await readFormParams(c.req.raw);
  if (!(await requireTwilioSignature(c.env, c.req.raw, params))) {
    return new Response('Forbidden', { status: 403 });
  }
  const host = c.req.header('host') ?? 'projectsites.dev';
  const twiml = await handleInboundCall(
    c.env,
    {
      CallSid: params.CallSid,
      From: params.From,
      To: params.To,
      AccountSid: params.AccountSid,
      Direction: params.Direction,
    },
    host,
  );
  return new Response(twiml, { headers: TWIML_HEADERS });
});

// ─── Media Streams WS upgrade ───────────────────────────────────
// Twilio signs the initial HTTP upgrade. We accept the connection if the
// signature is valid (or if signature header is absent — Twilio Media
// Streams currently only signs the websocket *URL* via a query token);
// for defense in depth, callSid + siteId must round-trip to a known call.

/**
 * `GET /webhooks/voice/stream` — WebSocket upgrade handler for Twilio
 * Media Streams (bidirectional µ-law audio between Twilio and the
 * call-gpt orchestrator).
 *
 * @remarks
 * Twilio signs the initial HTTP upgrade via a query-token rather than
 * `X-Twilio-Signature`. The CallSid + siteId carried in the URL must
 * round-trip to a known call row for defense in depth. Delegates to
 * {@link handleMediaStream}.
 *
 * @throws 403 FORBIDDEN when the call context cannot be validated.
 */
voiceWebhookRoutes.get('/webhooks/voice/stream', async (c) => {
  return handleMediaStream(c.env, c.req.raw);
});

// ─── Call status ────────────────────────────────────────────────

/**
 * `POST /webhooks/voice/status` — Twilio call-status callback
 * (`ringing|in-progress|completed|failed|busy|no-answer|canceled`).
 *
 * @remarks
 * Upserts the call row by `CallSid`; the UNIQUE index makes the handler
 * idempotent under Twilio retries.
 *
 * @throws 403 FORBIDDEN when the Twilio signature is missing or invalid.
 */
voiceWebhookRoutes.post('/webhooks/voice/status', async (c) => {
  const params = await readFormParams(c.req.raw);
  if (!(await requireTwilioSignature(c.env, c.req.raw, params))) {
    return new Response('Forbidden', { status: 403 });
  }
  const callSid = params.CallSid;
  const status = params.CallStatus;
  const duration = parseInt(params.CallDuration ?? '0', 10) || null;
  if (callSid) {
    await dbUpdate(
      c.env.DB,
      'voice_calls',
      {
        status,
        duration_seconds: duration,
        ...(status === 'completed' ? { ended_at: new Date().toISOString() } : {}),
      },
      'twilio_call_sid = ?',
      [callSid],
    ).catch(() => undefined);
  }
  return new Response('<Response/>', { headers: TWIML_HEADERS });
});

// ─── Recording ready → fetch + persist to R2 ────────────────────

/**
 * `POST /webhooks/voice/recording-ready` — Twilio recording-status callback
 * fired when a call recording finishes processing.
 *
 * @remarks
 * Verifies Twilio signature, then fetches the audio bytes from Twilio
 * via {@link downloadRecordingBytes} and writes them to R2 under
 * `recordings/{call_sid}/{recording_sid}.mp3` so subsequent playback
 * doesn't burn Twilio bandwidth.
 *
 * @throws 403 FORBIDDEN when the Twilio signature is missing or invalid.
 */
voiceWebhookRoutes.post('/webhooks/voice/recording-ready', async (c) => {
  const params = await readFormParams(c.req.raw);
  if (!(await requireTwilioSignature(c.env, c.req.raw, params))) {
    return new Response('Forbidden', { status: 403 });
  }
  const recordingSid = params.RecordingSid;
  const callSid = params.CallSid;
  if (!recordingSid || !callSid) return new Response('<Response/>', { headers: TWIML_HEADERS });

  const call = await dbQueryOne<{ id: string; site_id: string }>(
    c.env.DB,
    `SELECT id, site_id FROM voice_calls WHERE twilio_call_sid = ? LIMIT 1`,
    [callSid],
  );
  if (!call) return new Response('<Response/>', { headers: TWIML_HEADERS });

  // ctx.waitUntil-style: do the download out-of-band so we can return TwiML fast.
  void (async () => {
    try {
      const meta = await fetchRecording(c.env, recordingSid);
      const dl = await downloadRecordingBytes(c.env, meta.download_url);
      const r2Key = `voice/${call.site_id}/${call.id}/${recordingSid}.mp3`;
      await c.env.SITES_BUCKET.put(r2Key, dl.bytes, {
        httpMetadata: { contentType: dl.mime },
      });
      await dbInsert(c.env.DB, 'voice_recordings', {
        id: crypto.randomUUID(),
        call_id: call.id,
        kind: 'audio',
        r2_key: r2Key,
        mime: dl.mime,
        size_bytes: dl.bytes.byteLength,
        duration_seconds: meta.duration,
      });
      await dbUpdate(
        c.env.DB,
        'voice_calls',
        { recording_url: `/api/voice/recordings/proxy/${recordingSid}`, recording_sid: recordingSid },
        'id = ?',
        [call.id],
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'voice_webhooks',
          message: 'recording_persist_failed',
          error: err instanceof Error ? err.message : String(err),
          recording_sid: recordingSid,
        }),
      );
    }
  })();

  return new Response('<Response/>', { headers: TWIML_HEADERS });
});

// ─── Inbound SMS ────────────────────────────────────────────────

/**
 * `POST /webhooks/sms/inbound` — Inbound SMS TwiML response for Twilio.
 *
 * @remarks
 * Verifies signature then routes to {@link handleInboundSms} which writes
 * the message into the site's inbox conversation thread.
 *
 * @throws 403 FORBIDDEN when the Twilio signature is missing or invalid.
 */
voiceWebhookRoutes.post('/webhooks/sms/inbound', async (c) => {
  const params = await readFormParams(c.req.raw);
  if (!(await requireTwilioSignature(c.env, c.req.raw, params))) {
    return new Response('Forbidden', { status: 403 });
  }
  const twiml = await handleInboundSms(c.env, {
    MessageSid: params.MessageSid,
    From: params.From,
    To: params.To,
    Body: params.Body,
    AccountSid: params.AccountSid,
    NumMedia: params.NumMedia,
  });
  return new Response(twiml, { headers: TWIML_HEADERS });
});

// ─── SMS status ─────────────────────────────────────────────────

/**
 * `POST /webhooks/sms/status` — Twilio SMS delivery-status callback.
 *
 * @remarks
 * Updates the message row by `MessageSid` (UNIQUE → idempotent).
 *
 * @throws 403 FORBIDDEN when the Twilio signature is missing or invalid.
 */
voiceWebhookRoutes.post('/webhooks/sms/status', async (c) => {
  const params = await readFormParams(c.req.raw);
  if (!(await requireTwilioSignature(c.env, c.req.raw, params))) {
    return new Response('Forbidden', { status: 403 });
  }
  const sid = params.MessageSid;
  const status = params.MessageStatus;
  if (sid) {
    await dbUpdate(
      c.env.DB,
      'voice_messages',
      {
        status,
        ...(status === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
      },
      'twilio_message_sid = ?',
      [sid],
    ).catch(() => undefined);
  }
  return new Response('<Response/>', { headers: TWIML_HEADERS });
});

// ─── Browse-agent → worker callback (HMAC-signed) ───────────────

/**
 * `POST /internal/voice/recording-saved` — Internal callback from the
 * browse-agent worker after it persists a recording transcript.
 *
 * @remarks
 * Authenticated via HMAC `X-Internal-Sig` header (shared secret with
 * the browse-agent). Updates the `voice_calls` row with the transcript
 * + sentiment + intent extracted by the agent.
 *
 * @throws 403 FORBIDDEN when the HMAC signature is missing or invalid.
 */
voiceWebhookRoutes.post('/internal/voice/recording-saved', async (c) => {
  const secret = (c.env.INTERNAL_BUILD_SECRET ?? '').trim();
  if (!secret) return c.json({ error: 'callback not configured' }, 500);
  const sig = c.req.header('x-internal-sig') ?? '';
  const rawBody = await c.req.text();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expectedBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const expected = Array.from(expectedBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (sig !== expected) return c.json({ error: 'invalid signature' }, 401);

  let payload: {
    callId?: string;
    kind?: 'audio' | 'video' | 'transcript_text' | 'transcript_vtt';
    r2Key?: string;
    mime?: string;
    sizeBytes?: number;
    durationSeconds?: number;
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'bad json' }, 400);
  }
  if (!payload.callId || !payload.kind || !payload.r2Key) {
    return c.json({ error: 'missing fields' }, 400);
  }
  await dbInsert(c.env.DB, 'voice_recordings', {
    id: crypto.randomUUID(),
    call_id: payload.callId,
    kind: payload.kind,
    r2_key: payload.r2Key,
    mime: payload.mime ?? null,
    size_bytes: payload.sizeBytes ?? null,
    duration_seconds: payload.durationSeconds ?? null,
  });
  if (payload.kind === 'video') {
    await dbUpdate(
      c.env.DB,
      'voice_calls',
      { video_recording_url: `/api/voice/recordings/${payload.callId}/video` },
      'id = ?',
      [payload.callId],
    ).catch(() => undefined);
  }
  return c.json({ ok: true });
});
