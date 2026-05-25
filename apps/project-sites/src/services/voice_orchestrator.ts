/**
 * @module services/voice_orchestrator
 * @description High-level glue between Twilio webhooks, the AI agents, and
 * the per-call browse agent Durable Object.
 *
 * Three public entry points:
 *  - {@link handleInboundCall} — returns TwiML for the initial POST.
 *  - {@link handleMediaStream} — bidirectional WebSocket bridge (call-gpt
 *    pattern: STT → LLM → TTS, streaming both directions).
 *  - {@link handleInboundSms}  — returns TwiML for inbound SMS.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';
import { dbQueryOne, dbInsert, dbUpdate } from './db.js';
import {
  composeSystemPrompt,
  runTurn,
  synthesizeSpeech,
  transcribeAudioChunk,
  type VoiceAgentBusinessProfile,
  type VoiceAgentSiteSettings,
} from './voice_agent.js';
import { replyToInbound, type InboundSmsMessage } from './sms_agent.js';

// ─── Payload types ──────────────────────────────────────────────

export interface TwilioVoiceWebhookPayload {
  CallSid: string;
  From: string;
  To: string;
  AccountSid?: string;
  Direction?: string;
}

export interface TwilioSmsWebhookPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body?: string;
  AccountSid?: string;
  NumMedia?: string;
}

// ─── Inbound voice — return TwiML ───────────────────────────────

/**
 * Render TwiML for an inbound call.
 *
 * Returns a `<Response>` that:
 *  1. Plays a TCPA-compliant recording disclosure (`<Say>`)
 *  2. Opens a bidirectional Media Stream WebSocket to our worker
 *  3. Records the call (server-side, downloads to R2 on completion)
 */
export async function handleInboundCall(
  env: Env,
  payload: TwilioVoiceWebhookPayload,
  publicWorkerHost: string,
): Promise<string> {
  // Resolve the receiving number → site
  const numRow = await dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string;
  }>(
    env.DB,
    `SELECT id, site_id, org_id FROM voice_numbers
       WHERE phone_number = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
    [payload.To],
  );
  if (!numRow) {
    return wrapTwiml(
      `<Say voice="alice">This number is not configured. Please try again later.</Say><Hangup/>`,
    );
  }

  const settings = await loadAgentSettings(env, numRow.site_id);

  // Persist the call row up-front (idempotent on CallSid UNIQUE)
  await dbInsert(env.DB, 'voice_calls', {
    id: crypto.randomUUID(),
    voice_number_id: numRow.id,
    site_id: numRow.site_id,
    org_id: numRow.org_id,
    twilio_call_sid: payload.CallSid,
    direction: 'inbound',
    from_number: payload.From,
    to_number: payload.To,
    status: 'in-progress',
    started_at: new Date().toISOString(),
  }).catch(() => undefined);

  const wsUrl = `wss://${publicWorkerHost}/webhooks/voice/stream?callSid=${encodeURIComponent(payload.CallSid)}&siteId=${encodeURIComponent(numRow.site_id)}`;
  const recordingClause =
    settings.recording_enabled !== 0
      ? `<Record recordingStatusCallback="https://${publicWorkerHost}/webhooks/voice/recording-ready" recordingStatusCallbackEvent="completed"/>`
      : '';

  return wrapTwiml(
    `<Say voice="alice">This call may be recorded for quality and AI training.</Say>` +
      `<Connect><Stream url="${escapeXml(wsUrl)}"/></Connect>` +
      recordingClause,
  );
}

// ─── Inbound SMS — return TwiML ─────────────────────────────────

/**
 * Handle an inbound SMS by running the AI agent and returning TwiML that
 * sends the reply in the same HTTP response (no extra Twilio API call).
 *
 * If the agent's reply is empty (e.g. honored STOP silently), returns an
 * empty `<Response/>`.
 */
export async function handleInboundSms(
  env: Env,
  payload: TwilioSmsWebhookPayload,
): Promise<string> {
  const numRow = await dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string;
  }>(
    env.DB,
    `SELECT id, site_id, org_id FROM voice_numbers
       WHERE phone_number = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
    [payload.To],
  );
  if (!numRow) return wrapTwiml('');

  const settings = await loadAgentSettings(env, numRow.site_id);
  const profile = await loadBusinessProfile(env, numRow.site_id);

  const msg: InboundSmsMessage = {
    siteId: numRow.site_id,
    orgId: numRow.org_id,
    voiceNumberId: numRow.id,
    fromNumber: payload.From,
    toNumber: payload.To,
    body: payload.Body ?? '',
    twilioMessageSid: payload.MessageSid,
  };

  const result = await replyToInbound(env, msg, profile, settings);
  if (!result.replyText) return wrapTwiml('');
  return wrapTwiml(`<Message>${escapeXml(result.replyText)}</Message>`);
}

// ─── Media Streams bidirectional bridge ─────────────────────────

/**
 * Bridge a Twilio Media Streams WebSocket to the AI agent (call-gpt pattern).
 *
 * Inbound: receive base64-encoded mulaw 8kHz audio frames, buffer ~500ms,
 * pipe to {@link transcribeAudioChunk}, run a turn, synthesize the reply,
 * emit base64 mulaw frames back to Twilio.
 *
 * Returns the `Response` that Cloudflare's runtime expects for a WebSocket
 * upgrade (with `webSocket: client` body).
 */
export async function handleMediaStream(
  env: Env,
  request: Request,
): Promise<Response> {
  const upgrade = request.headers.get('upgrade');
  if (upgrade !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const url = new URL(request.url);
  const callSid = url.searchParams.get('callSid') ?? '';
  const siteId = url.searchParams.get('siteId') ?? '';
  if (!callSid || !siteId) {
    return new Response('callSid + siteId required', { status: 400 });
  }

  const callRow = await dbQueryOne<{
    id: string;
    org_id: string;
    from_number: string;
  }>(
    env.DB,
    `SELECT id, org_id, from_number FROM voice_calls
       WHERE twilio_call_sid = ? AND deleted_at IS NULL LIMIT 1`,
    [callSid],
  );
  if (!callRow) return new Response('Call not found', { status: 404 });

  const settings = await loadAgentSettings(env, siteId);
  const profile = await loadBusinessProfile(env, siteId);
  const systemPrompt = composeSystemPrompt(settings, profile, 'voice');

  // Greeting
  const greeting = `Hi, you've reached ${profile.businessName}. I'm the AI concierge — how can I help you today?`;

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  (server as unknown as { accept: () => void }).accept();

  // Streaming state
  let audioBuffer: Uint8Array = new Uint8Array(0);
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'assistant', content: greeting },
  ];
  let streamSid: string | null = null;
  let firstMediaSeen = false;
  const transcriptPieces: Array<{ role: 'user' | 'assistant'; content: string; ts: number }> = [
    { role: 'assistant', content: greeting, ts: Date.now() },
  ];

  server.addEventListener('message', (event: MessageEvent) => {
    // All processing async — fire and forget per event
    void (async () => {
      try {
        const raw = typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
        const frame = JSON.parse(raw) as {
          event?: string;
          streamSid?: string;
          media?: { payload?: string };
          start?: { streamSid?: string };
        };
        if (frame.event === 'start') {
          streamSid = frame.start?.streamSid ?? frame.streamSid ?? null;
          // Send greeting TTS immediately
          await emitTts(env, server, streamSid, greeting, settings.voice_voice_id);
        } else if (frame.event === 'media' && frame.media?.payload) {
          firstMediaSeen = true;
          const chunk = base64ToBytes(frame.media.payload);
          audioBuffer = concatBytes(audioBuffer, chunk);
          // Flush every ~500ms of 8kHz mulaw = 4000 bytes
          if (audioBuffer.byteLength >= 8000) {
            const slice = audioBuffer;
            audioBuffer = new Uint8Array(0);
            const transcript = await transcribeAudioChunk(env, slice.buffer as ArrayBuffer);
            if (transcript.text && transcript.text.trim().length > 1) {
              transcriptPieces.push({ role: 'user', content: transcript.text, ts: Date.now() });
              const turn = await runTurn(env, {
                sessionId: callRow.id,
                siteId,
                orgId: callRow.org_id,
                systemPrompt,
                userTranscript: transcript.text,
                history,
                enableBrowseAgent: settings.video_browse_enabled !== 0,
                mode: 'voice',
                model: settings.voice_model ?? undefined,
              });
              history.push({ role: 'user', content: transcript.text });
              history.push({ role: 'assistant', content: turn.text });
              transcriptPieces.push({ role: 'assistant', content: turn.text, ts: Date.now() });

              // Persist signals as they happen
              if (turn.signal === 'escalated_safety' || turn.signal === 'flagged_scam') {
                await dbUpdate(
                  env.DB,
                  'voice_calls',
                  { sentiment: turn.signal },
                  'id = ?',
                  [callRow.id],
                ).catch(() => undefined);
              }

              // Deferred browse-agent call → fire DO
              for (const tc of turn.toolCalls) {
                if (tc.name === 'browse_web' || tc.name === 'fill_form') {
                  void triggerBrowseAgent(env, callRow.id, JSON.stringify(tc.args)).catch(() => undefined);
                }
              }

              await emitTts(env, server, streamSid, turn.text, settings.voice_voice_id);
            }
          }
        } else if (frame.event === 'stop') {
          await finalizeCall(env, callRow.id, transcriptPieces);
          server.close(1000, 'stream stopped');
        }
      } catch (err) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            service: 'voice_orchestrator',
            message: 'media_stream_frame_failed',
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    })();
  });

  server.addEventListener('close', () => {
    void finalizeCall(env, callRow.id, transcriptPieces).catch(() => undefined);
  });

  // If we never see media, still finalize gracefully when the socket closes.
  void firstMediaSeen;

  return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit);
}

// ─── Browse-agent trigger ───────────────────────────────────────

/**
 * Fire-and-forget call into the `VoiceBrowseAgent` Durable Object.
 *
 * The DO class is built by a sibling agent; the binding is documented in
 * `wrangler.toml` (commented until the class ships). When the binding is
 * absent this becomes a no-op so deploys never break.
 */
export async function triggerBrowseAgent(
  env: Env,
  callId: string,
  userQuery: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!env.VOICE_BROWSE_AGENT) return { ok: false, reason: 'binding_missing' };
  try {
    const id = env.VOICE_BROWSE_AGENT.idFromName(callId);
    const stub = env.VOICE_BROWSE_AGENT.get(id);
    const res = await stub.fetch('http://browse-agent/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callId, query: userQuery }),
    });
    return { ok: res.ok, reason: res.ok ? undefined : `status ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown' };
  }
}

// ─── helpers ────────────────────────────────────────────────────

async function loadAgentSettings(env: Env, siteId: string): Promise<VoiceAgentSiteSettings> {
  const row = await dbQueryOne<VoiceAgentSiteSettings>(
    env.DB,
    `SELECT voice_system_prompt, sms_system_prompt, voice_model, sms_model,
            voice_voice_id, escalation_phone, business_hours_json,
            knowledge_base_urls, max_call_seconds, recording_enabled,
            video_browse_enabled, mcp_connection_ids
       FROM voice_agent_settings
       WHERE site_id = ? AND deleted_at IS NULL LIMIT 1`,
    [siteId],
  );
  return row ?? {};
}

async function loadBusinessProfile(env: Env, siteId: string): Promise<VoiceAgentBusinessProfile> {
  const site = await dbQueryOne<{
    business_name: string | null;
    business_address: string | null;
  }>(
    env.DB,
    `SELECT business_name, business_address FROM sites WHERE id = ? LIMIT 1`,
    [siteId],
  );
  return {
    businessName: site?.business_name ?? 'this business',
    businessLocation: site?.business_address ?? undefined,
  };
}

async function emitTts(
  env: Env,
  socket: WebSocket,
  streamSid: string | null,
  text: string,
  voiceId: string | null | undefined,
): Promise<void> {
  if (!streamSid || !text.trim()) return;
  const tts = await synthesizeSpeech(env, text, voiceId);
  if (tts.bytes.byteLength === 0) return; // stub mode — silent
  const payload = bytesToBase64(new Uint8Array(tts.bytes));
  socket.send(
    JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload },
    }),
  );
}

async function finalizeCall(
  env: Env,
  callId: string,
  transcriptPieces: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>,
): Promise<void> {
  const summary = transcriptPieces
    .filter((p) => p.role === 'user')
    .map((p) => p.content)
    .join(' • ')
    .slice(0, 400);
  await dbUpdate(
    env.DB,
    'voice_calls',
    {
      status: 'completed',
      ended_at: new Date().toISOString(),
      transcript_json: JSON.stringify(transcriptPieces),
      summary,
    },
    'id = ?',
    [callId],
  ).catch(() => undefined);
}

function wrapTwiml(inner: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
