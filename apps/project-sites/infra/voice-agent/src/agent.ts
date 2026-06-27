/**
 * ProjectSites AI phone receptionist — LiveKit Cloud agent.
 *
 * Runtime: LiveKit Cloud agent hosting (always-on, autoscaled, co-located with the
 * media servers) — see `apps/project-sites/docs/decisions/voice-architecture.md`
 * (LiveKit amendment + runtime pivot). A caller dials a per-site number → Twilio
 * Elastic SIP trunk → LiveKit Cloud SIP ingress → room → this agent joins as the
 * receptionist participant.
 *
 * Pipeline (our own keys, not LiveKit inference billing — cost control):
 *   - STT  : Deepgram `flux-general` (conversational STT w/ integrated end-of-turn)
 *   - LLM  : OpenAI gpt-4o-mini (streaming)
 *   - TTS  : OpenAI gpt-4o-mini-tts (FIRST-LIGHT, our key, the documented Piper
 *            fallback) → swap to the bundled Piper custom TTS plugin (slice 2 TODO)
 *   - VAD/turn: silero VAD + LiveKit multilingual turn detection + barge-in
 *
 * Deploy: `lk agent create` (first time, generates livekit.toml) then `lk agent deploy`.
 * Env: DEEPGRAM_API_KEY, OPENAI_API_KEY, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
 */
import { fileURLToPath } from 'node:url';
import { cli, defineAgent, voice, WorkerOptions, type JobContext, type JobProcess } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import * as openai from '@livekit/agents-plugin-openai';
import * as silero from '@livekit/agents-plugin-silero';
import * as livekit from '@livekit/agents-plugin-livekit';
import 'dotenv/config';

/** Fallback persona used until the per-site lookup is wired (slice 2 TODO). */
const DEFAULT_PERSONA =
  'You are a warm, concise, professional phone receptionist for a small business. ' +
  'Greet the caller, find out why they are calling, answer what you can, and offer to ' +
  'take a message or schedule a follow-up. Keep replies short and natural for speech. ' +
  'Never invent business details you were not given.';

/**
 * Resolve the per-site persona for this call.
 *
 * TODO(slice-2): the SIP participant carries the dialed DID in its attributes
 * (e.g. `sip.trunkPhoneNumber` / `sip.phoneNumber`). Look the number up against the
 * platform (site → persona) and fall back to {@link DEFAULT_PERSONA}. Stubbed to the
 * default until the number↔site mapping endpoint lands.
 */
async function resolvePersona(_ctx: JobContext): Promise<string> {
  return DEFAULT_PERSONA;
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
    const instructions = await resolvePersona(ctx);

    const session = new voice.AgentSession({
      vad: (await ctx.proc.userData.vad) as silero.VAD,
      stt: new deepgram.STT({ model: 'flux-general-en' }),
      llm: new openai.LLM({ model: 'gpt-4o-mini' }),
      // FIRST-LIGHT TTS — OpenAI (our key). TODO(slice-2): swap to the Piper custom
      // TTS plugin (free, self-hosted, bundled in the Dockerfile) per the voice ADR.
      tts: new openai.TTS({ model: 'gpt-4o-mini-tts', voice: 'alloy' }),
      turnDetection: new livekit.turnDetector.MultilingualModel(),
    });

    await session.start({ agent: new Receptionist(instructions), room: ctx.room });
    await ctx.connect();
    await session.generateReply({
      instructions: 'Greet the caller warmly in one short sentence and ask how you can help.',
    });
  },
});

cli.runApp(
  new WorkerOptions({ agent: fileURLToPath(import.meta.url), agentName: 'projectsites-receptionist' }),
);
