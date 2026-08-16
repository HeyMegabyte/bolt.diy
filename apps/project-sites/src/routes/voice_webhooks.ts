/**
 * @module routes/voice_webhooks
 * @description Public, Twilio-signature-verified SMS + call-callback webhooks.
 *
 * | Path                              | Method | Purpose                                  |
 * | --------------------------------- | ------ | ---------------------------------------- |
 * | `/webhooks/voice/status`          | POST   | Twilio call status callback              |
 * | `/webhooks/voice/recording-ready` | POST   | Twilio recording-status callback (→ R2)  |
 * | `/webhooks/sms/inbound`           | POST   | TwiML for inbound SMS                    |
 * | `/webhooks/sms/status`            | POST   | Twilio SMS status callback               |
 * | `/internal/voice/recording-saved` | POST   | Browse-agent → worker callback (HMAC)    |
 *
 * The inbound VOICE call path (AI receptionist) runs on LiveKit Cloud (Twilio
 * number → SIP trunk → LiveKit → `infra/voice-agent`) — the worker is no longer
 * in the voice audio path. See `docs/decisions/voice-architecture.md`.
 *
 * Every Twilio webhook verifies `X-Twilio-Signature`. Missing or mismatched
 * signatures → 403. Webhooks are idempotent via UNIQUE indexes on the
 * Twilio SIDs (call/message).
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';

import type { Env, Variables } from '../types/env.js';

import { capture } from '../lib/posthog.js';
import { dbInsert, dbQueryOne, dbUpdate } from '../services/db.js';
import { downloadRecordingBytes, fetchRecording, validateSignature } from '../services/twilio.js';
import {
  AgentConfigRequestSchema,
  resolveVoiceAgentConfig,
} from '../services/voice_agent_config.js';
import { handleInboundSms } from '../services/voice_orchestrator.js';
import { recordVoiceTranscript, TranscriptRequestSchema } from '../services/voice_transcript.js';

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
    // Best-effort status write — dbUpdate returns { error } (never throws), so the
    // old .catch() was dead code that silently dropped a failed write. Twilio sends
    // further callbacks and the row already exists, so log the drop but still ack 200.
    const { error: statusErr } = await dbUpdate(
      c.env.DB,
      'voice_calls',
      {
        duration_seconds: duration,
        status,
        ...(status === 'completed' ? { ended_at: new Date().toISOString() } : {}),
      },
      'twilio_call_sid = ?',
      [callSid],
    );
    if (statusErr) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'voice_webhooks',
          message: 'voice_call_status_update_failed',
          twilio_call_sid: callSid,
          error: statusErr,
        }),
      );
    }
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
      const { error: recErr } = await dbInsert(c.env.DB, 'voice_recordings', {
        call_id: call.id,
        duration_seconds: meta.duration,
        id: crypto.randomUUID(),
        kind: 'audio',
        mime: dl.mime,
        r2_key: r2Key,
        size_bytes: dl.bytes.byteLength,
      });
      // Recording breadcrumb — best-effort (fire-and-forget; the R2 audio + the
      // voice_calls row already exist). Log a drop so it isn't silent.
      if (recErr) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'voice_webhooks',
            message: 'voice_recordings_insert_failed',
            call_id: call.id,
            error: recErr,
          }),
        );
      }
      const { error: recUpdateErr } = await dbUpdate(
        c.env.DB,
        'voice_calls',
        {
          recording_sid: recordingSid,
          recording_url: `/api/voice/recordings/proxy/${recordingSid}`,
        },
        'id = ?',
        [call.id],
      );
      if (recUpdateErr) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'voice_webhooks',
            message: 'voice_call_recording_link_update_failed',
            call_id: call.id,
            error: recUpdateErr,
          }),
        );
      }
    } catch (err) {
      console.warn(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
          level: 'warn',
          message: 'recording_persist_failed',
          recording_sid: recordingSid,
          service: 'voice_webhooks',
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
    AccountSid: params.AccountSid,
    Body: params.Body,
    From: params.From,
    MessageSid: params.MessageSid,
    NumMedia: params.NumMedia,
    To: params.To,
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
    const { error: smsStatusErr } = await dbUpdate(
      c.env.DB,
      'voice_messages',
      {
        status,
        ...(status === 'delivered' ? { delivered_at: new Date().toISOString() } : {}),
      },
      'twilio_message_sid = ?',
      [sid],
    );
    if (smsStatusErr) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'voice_webhooks',
          message: 'voice_message_status_update_failed',
          twilio_message_sid: sid,
          error: smsStatusErr,
        }),
      );
    }
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
    { hash: 'SHA-256', name: 'HMAC' },
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
  const { error: recErr } = await dbInsert(c.env.DB, 'voice_recordings', {
    call_id: payload.callId,
    duration_seconds: payload.durationSeconds ?? null,
    id: crypto.randomUUID(),
    kind: payload.kind,
    mime: payload.mime ?? null,
    r2_key: payload.r2Key,
    size_bytes: payload.sizeBytes ?? null,
  });
  // Recording breadcrumb — best-effort (the R2 asset already exists); the Twilio
  // webhook must still return 200 regardless. Log a drop so it isn't silent.
  if (recErr) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'voice_webhooks',
        message: 'voice_recordings_insert_failed',
        call_id: payload.callId,
        error: recErr,
      }),
    );
  }
  if (payload.kind === 'video') {
    const { error: videoUrlErr } = await dbUpdate(
      c.env.DB,
      'voice_calls',
      { video_recording_url: `/api/voice/recordings/${payload.callId}/video` },
      'id = ?',
      [payload.callId],
    );
    if (videoUrlErr) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'voice_webhooks',
          message: 'voice_call_video_url_update_failed',
          call_id: payload.callId,
          error: videoUrlErr,
        }),
      );
    }
  }
  return c.json({ ok: true });
});

// ─── Internal: per-site voice agent config (LiteLLM routing) ────

/**
 * `POST /internal/voice/agent-config` — HMAC-signed config fetch for the LiveKit
 * voice agent. Given a dialed number (DID), returns the site's persona + its
 * **LiteLLM** (OpenAI-compatible) LLM endpoint so the agent's ChatGPT brain is
 * routed through that site's LiteLLM facade (per-site key/budget/observability).
 *
 * @remarks
 * Same HMAC scheme as `/internal/voice/recording-saved` (`x-internal-sig` =
 * HMAC-SHA256 of the raw body with `INTERNAL_BUILD_SECRET`). The response carries
 * a per-site LiteLLM key — only over this signed channel; never logged.
 *
 * @throws 401 when the signature is invalid · 400 on bad body · 500 when unconfigured.
 */
voiceWebhookRoutes.post('/internal/voice/agent-config', async (c) => {
  const secret = (c.env.INTERNAL_BUILD_SECRET ?? '').trim();
  if (!secret) return c.json({ error: 'callback not configured' }, 500);
  const sig = c.req.header('x-internal-sig') ?? '';
  const rawBody = await c.req.text();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const expectedBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const expected = Array.from(expectedBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (sig !== expected) return c.json({ error: 'invalid signature' }, 401);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'bad json' }, 400);
  }
  const parsed = AgentConfigRequestSchema.safeParse(parsedBody);
  if (!parsed.success) return c.json({ error: 'missing fields' }, 400);

  const config = await resolveVoiceAgentConfig(
    c.env,
    parsed.data.dialedNumber,
    parsed.data.callerNumber,
  );
  return c.json(config);
});

// ─── Internal: persist a completed call transcript → Conversations ──

/**
 * `POST /internal/voice/transcript` — HMAC-signed call-transcript persistence from
 * the LiveKit agent at call end. Stores the transcript + metadata into `voice_calls`
 * (idempotent on the LiveKit room id) so the call appears in admin Conversations.
 *
 * @throws 401 invalid signature · 400 bad body · 500 unconfigured.
 */
voiceWebhookRoutes.post('/internal/voice/transcript', async (c) => {
  const secret = (c.env.INTERNAL_BUILD_SECRET ?? '').trim();
  if (!secret) return c.json({ error: 'callback not configured' }, 500);
  const sig = c.req.header('x-internal-sig') ?? '';
  const rawBody = await c.req.text();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  );
  const expectedBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(rawBody)));
  const expected = Array.from(expectedBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (sig !== expected) return c.json({ error: 'invalid signature' }, 401);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'bad json' }, 400);
  }
  const parsed = TranscriptRequestSchema.safeParse(parsedBody);
  if (!parsed.success) return c.json({ error: 'missing fields' }, 400);

  const result = await recordVoiceTranscript(c.env, parsed.data);

  // rec #42 — per-call metrics → PostHog (fire-and-forget; no-ops without a key).
  // Guarded: c.executionCtx throws when unavailable (e.g. under test) — skip then.
  if (result.stored && result.orgId) {
    try {
      capture(c.env, c.executionCtx, {
        distinctId: result.orgId,
        event: 'voice_call_completed',
        properties: {
          channel: 'voice',
          dialed_number: parsed.data.dialedNumber,
          duration_seconds: result.durationSeconds ?? 0,
          org_id: result.orgId,
          site_id: result.siteId,
          turn_count: result.turnCount ?? 0,
        },
      });
    } catch {
      /* no ExecutionContext (test/edge) — metrics are best-effort */
    }
  }

  return c.json(result);
});
