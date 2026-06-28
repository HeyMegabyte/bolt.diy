/**
 * @module services/voice_agent_config
 * @description Resolve the per-site runtime config the LiveKit voice agent needs
 * at call start: the site persona + the site's **LiteLLM** (OpenAI-compatible)
 * LLM endpoint, so the agent's ChatGPT brain is routed through THAT site's
 * LiteLLM facade (per-site virtual key, budgets, observability) rather than a
 * single global key. See `docs/decisions/voice-architecture.md`.
 *
 * The agent runs on LiveKit Cloud (separate from this worker), so it fetches
 * this config over an HMAC-signed internal endpoint (`/internal/voice/agent-config`)
 * keyed by the dialed phone number (DID), which it reads from the SIP participant.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

import type { Env } from '../types/env.js';

import { resolveEnvVarsForAI } from './ai_env_vars.js';
import { dbQueryOne } from './db.js';

/** Voice-optimized fallback persona used when a site hasn't customized one. */
export const DEFAULT_VOICE_PERSONA =
  'You are a warm, concise, professional phone receptionist for {business}. ' +
  'Speak in short, natural spoken sentences — never markdown or lists. Say numbers ' +
  'and times the way a person would. Greet the caller, find out why they are calling, ' +
  'answer what you can from what you know, and offer to take a message, schedule a ' +
  'follow-up, or transfer to a human. If you are unsure, say so and offer to take a ' +
  'message — never invent business details, prices, or availability you were not given.';

/** Opening line spoken at call start. Carries the AI-disclosure required by the
 * FCC TCPA ruling (FCC-24-17) + CA SB 1001 + EU AI Act Art. 50, plus a 2-party
 * recording notice. `{business}` is substituted; per-site override via the
 * `VOICE_DISCLOSURE` env var (compliance-as-config; roadmap #31/#35). */
export const DEFAULT_VOICE_DISCLOSURE =
  "Hi, you've reached {business}. I'm an AI assistant, and this call may be recorded " +
  'for quality. How can I help you today?';

/**
 * Per-vertical turn-taking presets (roadmap #8). Endpointing delays are the
 * single biggest perceived-naturalness lever after end-of-turn detection: callers
 * who spell names / numbers / addresses need a longer pause before the agent
 * speaks, while quick transactional calls (hours, a booking) want it snappy.
 * `interruptionMode` stays `adaptive` everywhere (the ML turn-detector already
 * rejects coughs/backchannels) — only the endpointing window varies by profile.
 */
export type TurnProfile = 'precise' | 'conversational' | 'transactional';
export interface TurnDetectionConfig {
  profile: TurnProfile;
  minEndpointingDelayMs: number;
  maxEndpointingDelayMs: number;
  interruptionMode: 'adaptive' | 'fixed';
}
export const TURN_PRESETS: Record<TurnProfile, Omit<TurnDetectionConfig, 'profile'>> = {
  // Default balanced profile.
  conversational: {
    interruptionMode: 'adaptive',
    maxEndpointingDelayMs: 2500,
    minEndpointingDelayMs: 480,
  },
  // Medical/legal/finance: callers spell account numbers, names, dates — wait longer.
  precise: { interruptionMode: 'adaptive', maxEndpointingDelayMs: 3000, minEndpointingDelayMs: 640 },
  // Restaurant/retail/booking: short yes/no turns — keep it snappy.
  transactional: {
    interruptionMode: 'adaptive',
    maxEndpointingDelayMs: 2000,
    minEndpointingDelayMs: 320,
  },
};

const PRECISE_RE =
  /medic|health|clinic|dental|hospital|legal|\blaw\b|attorney|financ|account|insur|\btax\b/i;
const TRANSACTIONAL_RE =
  /restaurant|cafe|coffee|salon|barber|spa|retail|\bshop\b|store|booking|reservation|food|bakery|pizza/i;

/**
 * Resolve a turn-taking profile from a free-text hint (the `VOICE_TURN_PROFILE`
 * env var, which may be an explicit profile name OR a business-type phrase).
 * Falls back to `conversational` for anything unrecognized.
 *
 * @example resolveTurnProfile('precise')        // → 'precise'
 * @example resolveTurnProfile('dental clinic')  // → 'precise'
 * @example resolveTurnProfile('pizza shop')     // → 'transactional'
 * @example resolveTurnProfile(undefined)        // → 'conversational'
 */
export function resolveTurnProfile(hint: string | undefined): TurnProfile {
  const h = (hint ?? '').trim().toLowerCase();
  if (h === 'precise' || h === 'conversational' || h === 'transactional') return h;
  if (PRECISE_RE.test(h)) return 'precise';
  if (TRANSACTIONAL_RE.test(h)) return 'transactional';
  return 'conversational';
}

/** Build the full {@link TurnDetectionConfig} for a hint. */
function buildTurnDetection(hint: string | undefined): TurnDetectionConfig {
  const profile = resolveTurnProfile(hint);
  return { profile, ...TURN_PRESETS[profile] };
}

/**
 * Resolved agent config returned to the LiveKit agent. `llm.apiKey` is a secret
 * (a per-site LiteLLM virtual key) — only ever returned over the HMAC-signed
 * internal endpoint, never logged.
 */
export interface VoiceAgentConfig {
  found: boolean;
  siteId: string | null;
  orgId: string | null;
  businessName: string;
  persona: string;
  /** Opening line (AI disclosure + recording notice) the agent speaks first. */
  disclosure: string;
  /** Per-vertical turn-taking tuning the agent applies to `turnHandling`. */
  turnDetection: TurnDetectionConfig;
  llm: {
    /** OpenAI-compatible base URL (LiteLLM). e.g. https://llm.megabyte.space/v1 */
    baseUrl: string;
    /** Per-site LiteLLM virtual key (or platform fallback). */
    apiKey: string;
    /** Model id the LiteLLM endpoint exposes. */
    model: string;
  };
}

/** Request body schema for `/internal/voice/agent-config`. */
export const AgentConfigRequestSchema = z.object({
  dialedNumber: z.string().min(3).max(32),
});
export type AgentConfigRequest = z.infer<typeof AgentConfigRequestSchema>;

/**
 * Resolve the per-site persona + LiteLLM LLM config for a dialed number.
 *
 * Precedence for each LLM field: per-site `ai_env_vars` (LITELLM_* / OPENAI_*) →
 * site `voice_agent_settings.voice_model` (model only) → platform worker env
 * (`LITELLM_BASE_URL`/`LITELLM_API_KEY`, else `OPENAI_API_KEY`) → safe defaults.
 *
 * @returns Always returns a usable config; `found:false` (with platform LLM +
 *   default persona) when the number isn't mapped to a site, so the agent can
 *   still answer gracefully instead of failing the call.
 */
export async function resolveVoiceAgentConfig(
  env: Env,
  dialedNumber: string,
): Promise<VoiceAgentConfig> {
  const platformBaseUrl = (env.LITELLM_BASE_URL ?? '').trim() || 'https://llm.megabyte.space/v1';
  const platformKey = (env.LITELLM_API_KEY ?? env.OPENAI_API_KEY ?? '').trim();

  const num = await dbQueryOne<{ site_id: string; org_id: string }>(
    env.DB,
    `SELECT site_id, org_id FROM voice_numbers
       WHERE phone_number = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`,
    [dialedNumber],
  );

  if (!num) {
    return {
      businessName: 'this business',
      disclosure: DEFAULT_VOICE_DISCLOSURE.replace('{business}', 'this business'),
      found: false,
      llm: { apiKey: platformKey, baseUrl: platformBaseUrl, model: 'gpt-4o-mini' },
      orgId: null,
      persona: DEFAULT_VOICE_PERSONA.replace('{business}', 'this business'),
      siteId: null,
      turnDetection: buildTurnDetection(undefined),
    };
  }

  const [vars, settings, site] = await Promise.all([
    resolveEnvVarsForAI(env, { orgId: num.org_id, siteId: num.site_id }).catch(
      () => ({}) as Record<string, string>,
    ),
    dbQueryOne<{ voice_system_prompt: string | null; voice_model: string | null }>(
      env.DB,
      `SELECT voice_system_prompt, voice_model FROM voice_agent_settings
         WHERE site_id = ? AND deleted_at IS NULL LIMIT 1`,
      [num.site_id],
    ),
    dbQueryOne<{ business_name: string | null }>(
      env.DB,
      `SELECT business_name FROM sites WHERE id = ? LIMIT 1`,
      [num.site_id],
    ),
  ]);

  const businessName = site?.business_name?.trim() || 'this business';
  const persona =
    settings?.voice_system_prompt?.trim() ||
    DEFAULT_VOICE_PERSONA.replace('{business}', businessName);
  const disclosure =
    (vars.VOICE_DISCLOSURE ?? '').trim().replace('{business}', businessName) ||
    DEFAULT_VOICE_DISCLOSURE.replace('{business}', businessName);
  const turnDetection = buildTurnDetection(vars.VOICE_TURN_PROFILE);

  const baseUrl =
    (vars.LITELLM_BASE_URL ?? vars.OPENAI_BASE_URL ?? vars.OPENAI_API_BASE ?? '').trim() ||
    platformBaseUrl;
  const apiKey = (vars.LITELLM_API_KEY ?? vars.OPENAI_API_KEY ?? '').trim() || platformKey;
  const model =
    (vars.LITELLM_MODEL ?? vars.VOICE_MODEL ?? settings?.voice_model ?? '').trim() || 'gpt-4o-mini';

  return {
    businessName,
    disclosure,
    found: true,
    llm: { apiKey, baseUrl, model },
    orgId: num.org_id,
    persona,
    siteId: num.site_id,
    turnDetection,
  };
}
