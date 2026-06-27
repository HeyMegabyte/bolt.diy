// =============================================================================
// projectsites-voice — Twilio Media Streams ↔ STT → LLM → TTS bridge
// -----------------------------------------------------------------------------
// V1 topology (twilio-labs/call-gpt): Deepgram streaming STT → OpenAI
// gpt-4o-mini streaming brain → ElevenLabs Flash v2.5 TTS, full-duplex over a
// Twilio Media Stream (μ-law 8kHz). Provider-configurable via env so V2 can swap
// in self-hosted faster-whisper + Piper on the same Fly machine.
//
// See: apps/project-sites/docs/decisions/voice-architecture.md
// =============================================================================

import 'dotenv/config';
import { WebSocketServer } from 'ws';
import { createClient as createDeepgram, LiveTranscriptionEvents } from '@deepgram/sdk';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Config (env-driven; secrets never hard-coded)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 8080;
const STT_PROVIDER = (process.env.STT_PROVIDER || 'deepgram').toLowerCase(); // deepgram | whisper
const TTS_PROVIDER = (process.env.TTS_PROVIDER || 'elevenlabs').toLowerCase(); // elevenlabs | piper
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';

const DEFAULT_SYSTEM_PROMPT =
  'You are a friendly, concise phone receptionist. Answer in one or two short ' +
  'sentences. Speak naturally — this is a live voice call, not a chat window.';

const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// Structured log — console.warn (console.log is blocked by the repo eslint config).
function log(event, fields = {}) {
  console.warn(JSON.stringify({ service: 'voice', event, ...fields }));
}

// ---------------------------------------------------------------------------
// WebSocket server — one connection per active Twilio call
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ port: PORT });
log('listening', { port: PORT, stt: STT_PROVIDER, tts: TTS_PROVIDER, model: LLM_MODEL });

wss.on('connection', (ws) => {
  // Per-call state.
  const call = {
    streamSid: null,
    siteId: null,
    persona: null,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    history: [], // [{ role, content }]
    deepgram: null, // live STT connection
    speaking: false, // TTS currently streaming to caller?
    abort: null, // AbortController for in-flight LLM/TTS turn
  };

  ws.on('message', (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return; // ignore non-JSON frames
    }

    switch (frame.event) {
      case 'connected':
        log('twilio_connected');
        break;

      case 'start':
        handleStart(frame, call, ws);
        break;

      case 'media':
        handleMedia(frame, call);
        break;

      case 'stop':
        log('twilio_stop', { streamSid: call.streamSid });
        teardown(call);
        break;

      default:
        break;
    }
  });

  ws.on('close', () => {
    log('ws_close', { streamSid: call.streamSid });
    teardown(call);
  });

  ws.on('error', (err) => {
    log('ws_error', { message: err?.message });
    teardown(call);
  });
});

// ---------------------------------------------------------------------------
// START — capture streamSid + customParameters (siteId / persona)
// ---------------------------------------------------------------------------
function handleStart(frame, call, ws) {
  call.streamSid = frame.start?.streamSid || frame.streamSid || null;
  const params = frame.start?.customParameters || {};
  call.siteId = params.siteId || null;
  // persona may arrive as the system prompt directly, or a JSON string.
  call.persona = params.persona || null;
  if (params.systemPrompt) call.systemPrompt = params.systemPrompt;
  else if (params.persona) call.systemPrompt = params.persona;

  log('call_start', { streamSid: call.streamSid, siteId: call.siteId });

  // Open the STT stream for this call.
  startStt(call, ws);
}

// ---------------------------------------------------------------------------
// MEDIA — base64 μ-law 8kHz audio chunk from the caller → STT
// ---------------------------------------------------------------------------
function handleMedia(frame, call) {
  const payload = frame.media?.payload;
  if (!payload) return;

  if (STT_PROVIDER === 'deepgram' && call.deepgram) {
    // Deepgram wants raw bytes; Twilio sends base64 μ-law.
    call.deepgram.send(Buffer.from(payload, 'base64'));
  }
  // whisper branch: buffer audio per-utterance and POST on (VAD) silence — see startStt.
}

// ---------------------------------------------------------------------------
// STT — provider-selectable (deepgram default | whisper stub)
// ---------------------------------------------------------------------------
function startStt(call, ws) {
  if (STT_PROVIDER === 'whisper') {
    // TODO(V2): self-hosted faster-whisper. Buffer μ-law frames per utterance,
    // detect end-of-speech via VAD, decode μ-law→PCM16, POST to the local
    // faster-whisper HTTP endpoint, and feed the final transcript into onTranscript().
    // Mirrors the Deepgram final-transcript path below.
    log('stt_whisper_stub', { note: 'whisper STT not implemented — set STT_PROVIDER=deepgram' });
    return;
  }

  // --- Deepgram streaming (default) ---
  if (!DEEPGRAM_API_KEY) {
    log('stt_error', { message: 'DEEPGRAM_API_KEY missing' });
    return;
  }
  const dg = createDeepgram(DEEPGRAM_API_KEY);
  const connection = dg.listen.live({
    model: 'nova-2',
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    interim_results: true, // partials drive barge-in
    smart_format: true,
    endpointing: 250,
  });
  call.deepgram = connection;

  connection.on(LiveTranscriptionEvents.Open, () => log('stt_open'));

  connection.on(LiveTranscriptionEvents.Transcript, (data) => {
    const alt = data.channel?.alternatives?.[0];
    const text = alt?.transcript?.trim();
    if (!text) return;

    // Any fresh speech while we're talking = barge-in: stop TTS + abort the turn.
    if (call.speaking) bargeIn(call, ws);

    if (data.is_final) {
      log('stt_final', { text });
      onTranscript(call, ws, text);
    }
  });

  connection.on(LiveTranscriptionEvents.Error, (err) =>
    log('stt_error', { message: err?.message || String(err) }),
  );
  connection.on(LiveTranscriptionEvents.Close, () => log('stt_close'));
}

// ---------------------------------------------------------------------------
// Turn handler — final transcript → LLM (streaming) → TTS (streaming)
// ---------------------------------------------------------------------------
async function onTranscript(call, ws, userText) {
  if (!openai) {
    log('llm_error', { message: 'OPENAI_API_KEY missing' });
    return;
  }

  call.history.push({ role: 'user', content: userText });

  // Fresh abort controller for this turn so a later barge-in can cancel it.
  const ac = new AbortController();
  call.abort = ac;
  call.speaking = true;

  const messages = [{ role: 'system', content: call.systemPrompt }, ...call.history];

  let assistantText = '';
  let pending = ''; // buffer tokens, flush per sentence for snappy TTS

  try {
    const stream = await openai.chat.completions.create(
      { model: LLM_MODEL, messages, stream: true, temperature: 0.6 },
      { signal: ac.signal },
    );

    for await (const chunk of stream) {
      if (ac.signal.aborted) break;
      const token = chunk.choices?.[0]?.delta?.content || '';
      if (!token) continue;
      assistantText += token;
      pending += token;

      // Flush on sentence boundary → low-latency, natural-sounding TTS.
      if (/[.!?]\s*$/.test(pending) && pending.trim().length > 0) {
        await speak(call, ws, pending.trim(), ac.signal);
        pending = '';
      }
    }

    // Flush any trailing partial sentence.
    if (!ac.signal.aborted && pending.trim()) {
      await speak(call, ws, pending.trim(), ac.signal);
    }

    if (assistantText.trim()) {
      call.history.push({ role: 'assistant', content: assistantText.trim() });
    }
  } catch (err) {
    if (err?.name !== 'AbortError') log('llm_error', { message: err?.message || String(err) });
  } finally {
    if (call.abort === ac) {
      call.speaking = false;
      call.abort = null;
    }
  }
}

// ---------------------------------------------------------------------------
// TTS — provider-selectable (elevenlabs default | piper stub) → Twilio media
// ---------------------------------------------------------------------------
async function speak(call, ws, text, signal) {
  if (TTS_PROVIDER === 'piper') {
    // TODO(V2): self-hosted Piper. Run the local `piper` binary (en_US-*-medium),
    // capture its raw audio, resample to 8kHz μ-law, then base64-frame it back to
    // Twilio exactly like the ElevenLabs path below.
    log('tts_piper_stub', { note: 'piper TTS not implemented — set TTS_PROVIDER=elevenlabs' });
    return;
  }

  // --- ElevenLabs Flash v2.5 streaming (default) ---
  if (!ELEVENLABS_API_KEY) {
    log('tts_error', { message: 'ELEVENLABS_API_KEY missing' });
    return;
  }

  const url =
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream` +
    `?output_format=ulaw_8000`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/basic',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      }),
    });

    if (!res.ok || !res.body) {
      log('tts_error', { status: res.status });
      return;
    }

    // Stream μ-law chunks back to Twilio as media frames.
    for await (const chunk of res.body) {
      if (signal.aborted) break;
      sendMedia(ws, call.streamSid, Buffer.from(chunk).toString('base64'));
    }
  } catch (err) {
    if (err?.name !== 'AbortError') log('tts_error', { message: err?.message || String(err) });
  }
}

// ---------------------------------------------------------------------------
// Barge-in — caller interrupts: clear Twilio's buffered audio + abort the turn
// ---------------------------------------------------------------------------
function bargeIn(call, ws) {
  log('barge_in', { streamSid: call.streamSid });
  if (call.streamSid && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ event: 'clear', streamSid: call.streamSid }));
  }
  if (call.abort) call.abort.abort();
  call.speaking = false;
}

// ---------------------------------------------------------------------------
// Twilio media frame — base64 μ-law payload back to the caller
// ---------------------------------------------------------------------------
function sendMedia(ws, streamSid, payload) {
  if (!streamSid || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
}

// ---------------------------------------------------------------------------
// Teardown — close STT + abort any in-flight turn
// ---------------------------------------------------------------------------
function teardown(call) {
  try {
    if (call.deepgram) {
      call.deepgram.finish?.();
      call.deepgram = null;
    }
  } catch {
    /* already closed */
  }
  if (call.abort) {
    call.abort.abort();
    call.abort = null;
  }
  call.speaking = false;
}

// Graceful shutdown.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log('shutdown', { signal: sig });
    wss.close(() => process.exit(0));
  });
}
