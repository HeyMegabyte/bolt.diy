/**
 * ProjectSites AI phone receptionist — LiveKit Cloud agent.
 *
 * Runtime: LiveKit Cloud agent hosting (always-on, autoscaled, co-located with the
 * media servers) — see `apps/project-sites/docs/decisions/voice-architecture.md`.
 * Caller dials a per-site number → Twilio Elastic SIP trunk → LiveKit Cloud SIP →
 * room → this agent joins.
 *
 * Pipeline:
 *   - STT  : Deepgram Flux (STTv2 `flux-general-en`) — conversational, integrated EOU
 *   - LLM  : ChatGPT routed through the **dialed site's LiteLLM** endpoint
 *            (OpenAI-compatible baseURL + per-site virtual key + model), fetched at
 *            call start from the worker; platform LiteLLM fallback. (Brian 2026-06-27)
 *   - TTS  : OpenAI gpt-4o-mini-tts (first-light) → swap to bundled Piper plugin
 *   - turn : silero VAD + LiveKit multilingual turn detection + barge-in tuning
 *
 * Deploy: `lk agent create` then `lk agent deploy`.
 * Env: LIVEKIT_URL/API_KEY/API_SECRET, DEEPGRAM_API_KEY, OPENAI_API_KEY (TTS),
 *      VOICE_WORKER_URL (default https://projectsites.dev), INTERNAL_BUILD_SECRET
 *      (HMAC to the config endpoint), LITELLM_BASE_URL/LITELLM_API_KEY (LLM fallback).
 */
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  cli,
  defineAgent,
  voice,
  WorkerOptions,
  type JobContext,
  type JobProcess,
} from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import * as livekit from '@livekit/agents-plugin-livekit';
import 'dotenv/config';

const DEFAULT_PERSONA =
  'You are a warm, concise, professional phone receptionist for this business. ' +
  'Speak in short, natural spoken sentences — never markdown or lists. Say numbers and ' +
  'times the way a person would. Greet the caller, find out why they are calling, answer ' +
  'what you can, and offer to take a message, schedule a follow-up, or transfer to a human. ' +
  'If unsure, say so and offer to take a message — never invent details you were not given.';

interface TurnDetectionConfig {
  profile: string;
  minEndpointingDelayMs: number;
  maxEndpointingDelayMs: number;
  interruptionMode: 'adaptive' | 'fixed';
}

interface ReturningCallerInfo {
  known: boolean;
  priorCalls: number;
  lastSummary: string | null;
  lastCalledAt: string | null;
}

interface AgentConfig {
  persona: string;
  /** Opening line (AI disclosure + recording notice) the agent speaks first. */
  disclosure: string;
  /** Per-vertical turn-taking tuning applied to `turnHandling`. */
  turnDetection: TurnDetectionConfig;
  /** Memory of this caller's prior calls to this site. */
  returningCaller: ReturningCallerInfo;
  llm: { baseUrl: string; apiKey: string; model: string };
}

const UNKNOWN_CALLER: ReturningCallerInfo = {
  known: false,
  priorCalls: 0,
  lastSummary: null,
  lastCalledAt: null,
};

/** The balanced default disclosure + turn-taking when the worker config is
 * unreachable — mirrors the worker's `conversational` preset so a fallback call
 * still discloses + behaves naturally. */
const DEFAULT_DISCLOSURE =
  "Hi, thanks for calling. I'm an AI assistant, and this call may be recorded for " +
  'quality. How can I help you today?';
const DEFAULT_TURN_DETECTION: TurnDetectionConfig = {
  profile: 'conversational',
  minEndpointingDelayMs: 480,
  maxEndpointingDelayMs: 2500,
  interruptionMode: 'adaptive',
};

/**
 * Read the dialed DID (our number, which maps to a site) from the inbound SIP
 * participant's attributes. LiveKit SIP exposes the called number under one of a
 * few attribute keys depending on trunk config — try the known ones.
 * @remarks Confirm the exact key on the first live call; falls back to '' (→ the
 * worker returns a platform-LLM config so the call still answers).
 */
function resolveDialedNumber(ctx: JobContext): string {
  for (const p of ctx.room.remoteParticipants.values()) {
    const a = (p.attributes ?? {}) as Record<string, string>;
    const did =
      a['sip.trunkPhoneNumber'] ?? a['sip.phoneNumber'] ?? a['sip.dnis'] ?? a['sip.to'] ?? '';
    if (did) return did;
  }
  return '';
}

/**
 * Fetch the per-site persona + LiteLLM LLM config from the worker, HMAC-signed.
 * Falls back to env-configured platform LiteLLM/OpenAI on any failure so a call
 * is never dropped because the config service is unreachable.
 */
async function fetchAgentConfig(dialedNumber: string, callerNumber: string): Promise<AgentConfig> {
  const fallback: AgentConfig = {
    persona: DEFAULT_PERSONA,
    disclosure: DEFAULT_DISCLOSURE,
    turnDetection: DEFAULT_TURN_DETECTION,
    returningCaller: UNKNOWN_CALLER,
    llm: {
      baseUrl: process.env.LITELLM_BASE_URL ?? 'https://llm.megabyte.space/v1',
      apiKey: process.env.LITELLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
      model: 'gpt-4o-mini',
    },
  };
  const workerUrl = (process.env.VOICE_WORKER_URL ?? 'https://projectsites.dev').replace(/\/$/, '');
  const secret = process.env.INTERNAL_BUILD_SECRET ?? '';
  if (!secret || !dialedNumber) return fallback;
  try {
    const body = JSON.stringify(
      callerNumber ? { dialedNumber, callerNumber } : { dialedNumber },
    );
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    const res = await fetch(`${workerUrl}/internal/voice/agent-config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-sig': sig },
      body,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return fallback;
    const cfg = (await res.json()) as {
      persona?: string;
      disclosure?: string;
      turnDetection?: Partial<TurnDetectionConfig>;
      returningCaller?: Partial<ReturningCallerInfo>;
      llm?: AgentConfig['llm'];
    };
    if (!cfg.llm?.baseUrl || !cfg.llm.apiKey) return fallback;
    return {
      persona: cfg.persona || DEFAULT_PERSONA,
      disclosure: cfg.disclosure || DEFAULT_DISCLOSURE,
      turnDetection: { ...DEFAULT_TURN_DETECTION, ...cfg.turnDetection },
      returningCaller: { ...UNKNOWN_CALLER, ...cfg.returningCaller },
      llm: cfg.llm,
    };
  } catch {
    return fallback;
  }
}

/** The caller's number (FROM) from the SIP participant attributes, best-effort. */
function resolveCallerNumber(ctx: JobContext): string {
  for (const p of ctx.room.remoteParticipants.values()) {
    const a = (p.attributes ?? {}) as Record<string, string>;
    const from = a['sip.phoneNumber'] ?? a['sip.from'] ?? '';
    if (from) return from;
  }
  return '';
}

/** Flatten the session history into transcript turns for the Conversations store. */
function collectTranscript(
  session: voice.AgentSession,
): Array<{ role: 'user' | 'assistant' | 'system'; text: string }> {
  const out: Array<{ role: 'user' | 'assistant' | 'system'; text: string }> = [];
  for (const item of session.history.items) {
    if (item.type !== 'message') continue;
    const role = item.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    const text = item.textContent?.trim();
    if (text) out.push({ role, text });
  }
  return out;
}

/** POST the finished call transcript to the worker (HMAC-signed; best-effort). */
async function postTranscript(payload: {
  callId: string;
  dialedNumber: string;
  callerNumber?: string;
  transcript: Array<{ role: 'user' | 'assistant' | 'system'; text: string }>;
  startedAtMs: number;
  endedAtMs: number;
}): Promise<void> {
  const workerUrl = (process.env.VOICE_WORKER_URL ?? 'https://projectsites.dev').replace(/\/$/, '');
  const secret = process.env.INTERNAL_BUILD_SECRET ?? '';
  if (!secret || payload.transcript.length === 0) return;
  try {
    const body = JSON.stringify(payload);
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    await fetch(`${workerUrl}/internal/voice/transcript`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-sig': sig },
      body,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* best-effort — never block call teardown on transcript persistence */
  }
}

class Receptionist extends voice.Agent {
  constructor(instructions: string) {
    super({ instructions });
  }
}

export default defineAgent({
  prewarm: (proc: JobProcess) => {
    proc.userData.vad = silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    await ctx.connect();

    // Per-site LiteLLM routing: dialed DID → site → LiteLLM endpoint + virtual key.
    // Caller number (FROM) enables per-caller memory (returning-caller recognition).
    const dialedNumber = resolveDialedNumber(ctx);
    const callerNumber = resolveCallerNumber(ctx);
    const config = await fetchAgentConfig(dialedNumber, callerNumber);
    const startedAtMs = Date.now();

    // Per-caller memory (roadmap #14/#15): when this caller has called before,
    // tell the LLM so it greets them as a returning caller by their last topic.
    const personaWithMemory = config.returningCaller.known
      ? `${config.persona}\n\nNOTE: This caller has contacted ${
          config.returningCaller.priorCalls
        } time(s) before.${
          config.returningCaller.lastSummary
            ? ` Their last call was about: "${config.returningCaller.lastSummary}".`
            : ''
        } Greet them warmly as a returning caller and, if relevant, reference their prior topic — but never assume details you were not given.`
      : config.persona;

    const session = new voice.AgentSession({
      vad: (await ctx.proc.userData.vad) as silero.VAD,
      // Deepgram Flux (STTv2) — conversational STT with model-integrated end-of-turn.
      stt: new deepgram.STTv2({ model: 'flux-general-en' }),
      // ChatGPT via the SITE's LiteLLM (OpenAI-compatible) endpoint — per-site key/budget.
      llm: new openai.LLM({
        model: config.llm.model,
        baseURL: config.llm.baseUrl,
        apiKey: config.llm.apiKey,
      }),
      // FIRST-LIGHT TTS — OpenAI (our key). TODO: swap to the bundled Piper plugin.
      tts: new openai.TTS({ model: 'gpt-4o-mini-tts', voice: 'alloy' }),
      turnDetection: new livekit.turnDetector.MultilingualModel(),
      // Latency + barge-in tuning (LiveKit 1.4 `turnHandling`) — per-vertical
      // endpointing from the resolved site config (precise/conversational/
      // transactional). Spelled names/numbers get a longer pause; quick booking
      // calls stay snappy. Profile: ${config.turnDetection.profile}.
      turnHandling: {
        preemptiveGeneration: { enabled: true }, // run the LLM before EOU is final → lower TTFT
        interruption: { mode: config.turnDetection.interruptionMode }, // ML rejects cough/backchannel
        endpointing: {
          minDelay: config.turnDetection.minEndpointingDelayMs,
          maxDelay: config.turnDetection.maxEndpointingDelayMs,
        },
      },
    });

    // Per-turn metrics → structured log (LiveKit Cloud collects; mirror to our logs).
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      console.log(
        JSON.stringify({ level: 'info', msg: 'voice.metrics', ts: Date.now(), metrics: ev.metrics }),
      );
    });

    // On call end: persist the transcript → admin Conversations (best-effort, HMAC).
    session.on(voice.AgentSessionEventTypes.Close, () => {
      void postTranscript({
        callId: ctx.room.name || `room-${startedAtMs}`,
        dialedNumber,
        callerNumber: callerNumber || undefined,
        transcript: collectTranscript(session),
        startedAtMs,
        endedAtMs: Date.now(),
      });
    });

    await session.start({ agent: new Receptionist(personaWithMemory), room: ctx.room });

    // Spoken AI disclosure + recording notice (FCC TCPA / CA SB 1001 / EU AI Act
    // Art. 50) — the exact line is resolved per-site (compliance-as-config), so a
    // business can tune wording/jurisdiction without a code change.
    await session.generateReply({
      instructions:
        `Say this opening line naturally, warmly, as one spoken sentence: "${config.disclosure}"`,
    });
  },
});

cli.runApp(
  new WorkerOptions({ agent: fileURLToPath(import.meta.url), agentName: 'projectsites-receptionist' }),
);
