// =============================================================================
// projectsites-voice — Twilio Media Streams ↔ STT → LLM → TTS bridge
// -----------------------------------------------------------------------------
// Refined stack (Brian 2026-06-27): Deepgram Nova-3 streaming STT → OpenAI
// gpt-4o-mini streaming brain → Piper TTS (bundled, local child process) over a
// Twilio Media Stream (μ-law 8kHz). Piper raw s16le PCM @22050 → ffmpeg → μ-law
// 8000 → 160-byte (20ms) base64 frames. ElevenLabs removed. `openai` TTS is the
// fallback when Piper is unavailable.
//
// See: apps/project-sites/docs/decisions/voice-architecture.md
// =============================================================================

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { createClient as createDeepgram, LiveTranscriptionEvents } from '@deepgram/sdk';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Config (env-driven; secrets never hard-coded)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 8080;
const STT_PROVIDER = (process.env.STT_PROVIDER || 'deepgram').toLowerCase(); // deepgram | whisper
const TTS_PROVIDER = (process.env.TTS_PROVIDER || 'piper').toLowerCase(); // piper | openai
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Piper (bundled binary + voice model — no key, local spawn).
const PIPER_BIN = process.env.PIPER_BIN || '/app/piper/piper';
const PIPER_MODEL = process.env.PIPER_MODEL || '/app/voices/en_US-amy-medium.onnx';
const PIPER_SAMPLE_RATE = Number(process.env.PIPER_SAMPLE_RATE) || 22050;

// OpenAI TTS fallback voice (used only when TTS_PROVIDER=openai).
const OPENAI_TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const OPENAI_TTS_VOICE = process.env.OPENAI_TTS_VOICE || 'alloy';

// Twilio media framing: μ-law 8kHz mono = 8000 bytes/sec → 160 bytes per 20ms.
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const MULAW_FRAME_BYTES = 160;

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
    piper: null, // in-flight Piper child process
    ffmpeg: null, // in-flight ffmpeg transcode child process
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

  // --- Deepgram Nova-3 streaming (default) ---
  if (!DEEPGRAM_API_KEY) {
    log('stt_error', { message: 'DEEPGRAM_API_KEY missing' });
    return;
  }
  const dg = createDeepgram(DEEPGRAM_API_KEY);
  const connection = dg.listen.live({
    model: 'nova-3',
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

    // Any fresh speech (partial OR final) while we're talking = barge-in:
    // stop Piper+ffmpeg, abort the turn, and clear Twilio's buffered audio.
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
// TTS — provider-selectable (piper default, local | openai fallback) → Twilio
// ---------------------------------------------------------------------------
async function speak(call, ws, text, signal) {
  if (!text) return;
  if (TTS_PROVIDER === 'openai') {
    return speakOpenAi(call, ws, text, signal);
  }
  return speakPiper(call, ws, text, signal);
}

// ---------------------------------------------------------------------------
// Piper TTS (default) — local child process.
//   piper --model $PIPER_MODEL --output_raw   (text on stdin → s16le PCM @22050)
//     → ffmpeg -f s16le -ar 22050 -ac 1 -i pipe:0 -ar 8000 -ac 1 -f mulaw pipe:1
//       → 160-byte (20ms) μ-law frames → base64 → Twilio media frames
// ---------------------------------------------------------------------------
function speakPiper(call, ws, text, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();

    let piper;
    let ffmpeg;
    try {
      piper = spawn(PIPER_BIN, ['--model', PIPER_MODEL, '--output_raw'], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      ffmpeg = spawn(
        FFMPEG_BIN,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          's16le',
          '-ar',
          String(PIPER_SAMPLE_RATE),
          '-ac',
          '1',
          '-i',
          'pipe:0',
          '-ar',
          '8000',
          '-ac',
          '1',
          '-f',
          'mulaw',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'ignore'] },
      );
    } catch (err) {
      log('tts_error', { provider: 'piper', message: err?.message || String(err) });
      return resolve();
    }

    // Track on the call so barge-in/teardown can kill the in-flight render.
    call.piper = piper;
    call.ffmpeg = ffmpeg;

    let settled = false;
    let leftover = Buffer.alloc(0); // hold partial μ-law frames across ffmpeg chunks

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (call.piper === piper) call.piper = null;
      if (call.ffmpeg === ffmpeg) call.ffmpeg = null;
      try {
        piper.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      try {
        ffmpeg.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    };

    const onAbort = () => cleanup();
    signal.addEventListener('abort', onAbort, { once: true });

    // Piper PCM → ffmpeg stdin.
    piper.stdout.on('data', (pcm) => {
      if (signal.aborted) return;
      if (ffmpeg.stdin.writable) ffmpeg.stdin.write(pcm);
    });
    piper.on('error', (err) => {
      log('tts_error', { provider: 'piper', stage: 'piper_spawn', message: err?.message });
      cleanup();
    });
    piper.on('close', () => {
      // No more PCM — close ffmpeg's input so it flushes the tail.
      try {
        ffmpeg.stdin.end();
      } catch {
        /* already closed */
      }
    });

    // ffmpeg μ-law 8000 → 160-byte frames → base64 → Twilio (streamed as they arrive).
    ffmpeg.stdout.on('data', (chunk) => {
      if (signal.aborted) return cleanup();
      let buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      let offset = 0;
      while (buf.length - offset >= MULAW_FRAME_BYTES) {
        const frame = buf.subarray(offset, offset + MULAW_FRAME_BYTES);
        sendMedia(ws, call.streamSid, frame.toString('base64'));
        offset += MULAW_FRAME_BYTES;
      }
      leftover = buf.subarray(offset);
    });
    ffmpeg.on('error', (err) => {
      log('tts_error', { provider: 'piper', stage: 'ffmpeg_spawn', message: err?.message });
      cleanup();
    });
    ffmpeg.on('close', () => {
      // Emit any final partial frame so the tail of the utterance isn't dropped.
      if (!signal.aborted && leftover.length > 0) {
        sendMedia(ws, call.streamSid, leftover.toString('base64'));
      }
      signal.removeEventListener('abort', onAbort);
      cleanup();
    });

    // Drive Piper: write the sentence to stdin, then close it to trigger synthesis.
    try {
      piper.stdin.write(text);
      piper.stdin.end();
    } catch (err) {
      log('tts_error', { provider: 'piper', stage: 'stdin', message: err?.message });
      cleanup();
    }
  });
}

// ---------------------------------------------------------------------------
// OpenAI TTS (fallback, TTS_PROVIDER=openai) — /v1/audio/speech, pcm response →
// same ffmpeg transcode (s16le @24000 → μ-law 8000) → 160-byte frames → Twilio.
// ---------------------------------------------------------------------------
async function speakOpenAi(call, ws, text, signal) {
  if (!OPENAI_API_KEY) {
    log('tts_error', { provider: 'openai', message: 'OPENAI_API_KEY missing' });
    return;
  }

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_TTS_MODEL,
        voice: OPENAI_TTS_VOICE,
        input: text,
        response_format: 'pcm', // raw s16le mono @24000
      }),
    });
  } catch (err) {
    if (err?.name !== 'AbortError') {
      log('tts_error', { provider: 'openai', stage: 'fetch', message: err?.message || String(err) });
    }
    return;
  }

  if (!res.ok || !res.body) {
    log('tts_error', { provider: 'openai', status: res.status });
    return;
  }

  await new Promise((resolve) => {
    let ffmpeg;
    try {
      ffmpeg = spawn(
        FFMPEG_BIN,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          's16le',
          '-ar',
          '24000', // OpenAI pcm response is 24kHz mono s16le
          '-ac',
          '1',
          '-i',
          'pipe:0',
          '-ar',
          '8000',
          '-ac',
          '1',
          '-f',
          'mulaw',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'ignore'] },
      );
    } catch (err) {
      log('tts_error', { provider: 'openai', stage: 'ffmpeg_spawn', message: err?.message });
      return resolve();
    }

    call.ffmpeg = ffmpeg;
    let settled = false;
    let leftover = Buffer.alloc(0);

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (call.ffmpeg === ffmpeg) call.ffmpeg = null;
      try {
        ffmpeg.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    };

    const onAbort = () => cleanup();
    signal.addEventListener('abort', onAbort, { once: true });

    ffmpeg.stdout.on('data', (chunk) => {
      if (signal.aborted) return cleanup();
      let buf = leftover.length ? Buffer.concat([leftover, chunk]) : chunk;
      let offset = 0;
      while (buf.length - offset >= MULAW_FRAME_BYTES) {
        const frame = buf.subarray(offset, offset + MULAW_FRAME_BYTES);
        sendMedia(ws, call.streamSid, frame.toString('base64'));
        offset += MULAW_FRAME_BYTES;
      }
      leftover = buf.subarray(offset);
    });
    ffmpeg.on('error', (err) => {
      log('tts_error', { provider: 'openai', stage: 'ffmpeg', message: err?.message });
      cleanup();
    });
    ffmpeg.on('close', () => {
      if (!signal.aborted && leftover.length > 0) {
        sendMedia(ws, call.streamSid, leftover.toString('base64'));
      }
      signal.removeEventListener('abort', onAbort);
      cleanup();
    });

    // Pump the OpenAI PCM body into ffmpeg's stdin.
    (async () => {
      try {
        for await (const chunk of res.body) {
          if (signal.aborted) break;
          if (ffmpeg.stdin.writable) ffmpeg.stdin.write(chunk);
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          log('tts_error', { provider: 'openai', stage: 'pump', message: err?.message });
        }
      } finally {
        try {
          ffmpeg.stdin.end();
        } catch {
          /* already closed */
        }
      }
    })();
  });
}

// ---------------------------------------------------------------------------
// Barge-in — caller interrupts: kill the in-flight Piper+ffmpeg render, abort
// the LLM stream, and clear Twilio's buffered audio.
// ---------------------------------------------------------------------------
function bargeIn(call, ws) {
  log('barge_in', { streamSid: call.streamSid });
  if (call.streamSid && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ event: 'clear', streamSid: call.streamSid }));
  }
  killTts(call);
  if (call.abort) call.abort.abort();
  call.speaking = false;
}

// ---------------------------------------------------------------------------
// Kill any in-flight TTS children (Piper + ffmpeg).
// ---------------------------------------------------------------------------
function killTts(call) {
  try {
    if (call.piper) {
      call.piper.kill('SIGKILL');
      call.piper = null;
    }
  } catch {
    /* already gone */
  }
  try {
    if (call.ffmpeg) {
      call.ffmpeg.kill('SIGKILL');
      call.ffmpeg = null;
    }
  } catch {
    /* already gone */
  }
}

// ---------------------------------------------------------------------------
// Twilio media frame — base64 μ-law payload back to the caller
// ---------------------------------------------------------------------------
function sendMedia(ws, streamSid, payload) {
  if (!streamSid || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ event: 'media', streamSid, media: { payload } }));
}

// ---------------------------------------------------------------------------
// Teardown — close STT, kill TTS children, abort any in-flight turn
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
  killTts(call);
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
