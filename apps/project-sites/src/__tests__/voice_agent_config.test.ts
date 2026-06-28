/**
 * Per-site voice agent config (LiteLLM routing) — `services/voice_agent_config`
 * + the HMAC-signed `/internal/voice/agent-config` route. The agent fetches a
 * site's persona + LiteLLM (OpenAI-compatible) LLM endpoint keyed by dialed DID.
 *
 * db + ai_env_vars are mocked; resolveVoiceAgentConfig runs for real so the
 * field-precedence (per-site → platform fallback) is actually exercised.
 */
jest.mock('../services/db.js', () => ({
  dbQueryOne: jest.fn(),
}));
jest.mock('../services/ai_env_vars.js', () => ({
  resolveEnvVarsForAI: jest.fn(async () => ({})),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne } from '../services/db.js';
import { resolveEnvVarsForAI } from '../services/ai_env_vars.js';
import { resolveTurnProfile, resolveVoiceAgentConfig } from '../services/voice_agent_config.js';
import { voiceWebhookRoutes } from '../routes/voice_webhooks.js';

const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockResolveVars = resolveEnvVarsForAI as unknown as jest.Mock;

const PLATFORM = {
  LITELLM_BASE_URL: 'https://llm.megabyte.space/v1',
  LITELLM_API_KEY: 'sk-platform',
};

function makeEnv(over: Record<string, unknown> = {}): Env {
  return { DB: {} as unknown, ...PLATFORM, ...over } as unknown as Env;
}

beforeEach(() => {
  mockQueryOne.mockReset();
  mockResolveVars.mockReset().mockResolvedValue({});
});

describe('resolveVoiceAgentConfig', () => {
  it('falls back to platform LLM + default persona when the number is unmapped', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // voice_numbers miss
    const cfg = await resolveVoiceAgentConfig(makeEnv(), '+15550000000');
    expect(cfg.found).toBe(false);
    expect(cfg.llm).toEqual({
      baseUrl: 'https://llm.megabyte.space/v1',
      apiKey: 'sk-platform',
      model: 'gpt',
    });
    expect(cfg.persona).toContain('receptionist');
    // Unmapped calls still get a disclosure + the balanced turn preset.
    expect(cfg.disclosure).toContain('AI assistant');
    expect(cfg.disclosure).toContain('this business');
    expect(cfg.turnDetection).toEqual({
      profile: 'conversational',
      minEndpointingDelayMs: 480,
      maxEndpointingDelayMs: 2500,
      interruptionMode: 'adaptive',
    });
    expect(cfg.returningCaller).toEqual({
      known: false,
      priorCalls: 0,
      lastSummary: null,
      lastCalledAt: null,
    });
  });

  it('routes the LLM through the SITE LiteLLM endpoint when per-site vars exist', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ site_id: 'site-1', org_id: 'org-1' }) // voice_numbers
      .mockResolvedValueOnce({ voice_system_prompt: 'You are Vito.', voice_model: null }) // settings
      .mockResolvedValueOnce({ business_name: "Vito's Salon" }); // site
    mockResolveVars.mockResolvedValueOnce({
      LITELLM_BASE_URL: 'https://litellm.vito.dev/v1',
      LITELLM_API_KEY: 'sk-vito-virtual',
      LITELLM_MODEL: 'gpt-4o',
    });
    const cfg = await resolveVoiceAgentConfig(makeEnv(), '+15551234567');
    expect(cfg.found).toBe(true);
    expect(cfg.siteId).toBe('site-1');
    expect(cfg.llm).toEqual({
      baseUrl: 'https://litellm.vito.dev/v1',
      apiKey: 'sk-vito-virtual',
      model: 'gpt-4o',
    });
    expect(cfg.persona).toBe('You are Vito.');
  });

  it('uses platform LLM + voice_model + default persona when site has no LiteLLM vars', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ site_id: 'site-2', org_id: 'org-1' })
      .mockResolvedValueOnce({ voice_system_prompt: null, voice_model: 'gpt-4.1-mini' })
      .mockResolvedValueOnce({ business_name: 'Acme' });
    const cfg = await resolveVoiceAgentConfig(makeEnv(), '+15559999999');
    expect(cfg.llm.baseUrl).toBe('https://llm.megabyte.space/v1');
    expect(cfg.llm.apiKey).toBe('sk-platform');
    expect(cfg.llm.model).toBe('gpt-4.1-mini'); // from voice_agent_settings
    expect(cfg.persona).toContain('Acme');
  });
});

describe('resolveTurnProfile (roadmap #8)', () => {
  it('passes through explicit profile names', () => {
    expect(resolveTurnProfile('precise')).toBe('precise');
    expect(resolveTurnProfile('transactional')).toBe('transactional');
    expect(resolveTurnProfile('conversational')).toBe('conversational');
  });
  it('classifies precise verticals (callers spell names/numbers)', () => {
    expect(resolveTurnProfile('dental clinic')).toBe('precise');
    expect(resolveTurnProfile('Law Office of Smith')).toBe('precise');
    expect(resolveTurnProfile('tax & accounting')).toBe('precise');
  });
  it('classifies transactional verticals (quick yes/no turns)', () => {
    expect(resolveTurnProfile('pizza shop')).toBe('transactional');
    expect(resolveTurnProfile('hair salon')).toBe('transactional');
    expect(resolveTurnProfile('table reservation')).toBe('transactional');
  });
  it('falls back to conversational for unknown or empty hints', () => {
    expect(resolveTurnProfile(undefined)).toBe('conversational');
    expect(resolveTurnProfile('')).toBe('conversational');
    expect(resolveTurnProfile('consulting agency')).toBe('conversational');
  });
});

describe('resolveVoiceAgentConfig — turn presets + disclosure (roadmap #8/#31)', () => {
  it('applies the precise preset + a custom disclosure from per-site env vars', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ site_id: 'site-3', org_id: 'org-1' })
      .mockResolvedValueOnce({ voice_system_prompt: null, voice_model: null })
      .mockResolvedValueOnce({ business_name: 'Smile Dental' });
    mockResolveVars.mockResolvedValueOnce({
      VOICE_TURN_PROFILE: 'precise',
      VOICE_DISCLOSURE: 'You have reached {business}, an AI-assisted line.',
    });
    const cfg = await resolveVoiceAgentConfig(makeEnv(), '+15551112222');
    expect(cfg.turnDetection).toEqual({
      profile: 'precise',
      minEndpointingDelayMs: 640,
      maxEndpointingDelayMs: 3000,
      interruptionMode: 'adaptive',
    });
    // {business} is substituted in the per-site disclosure override.
    expect(cfg.disclosure).toBe('You have reached Smile Dental, an AI-assisted line.');
  });

  it('classifies a transactional profile from a business-type hint + default disclosure', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ site_id: 'site-4', org_id: 'org-1' })
      .mockResolvedValueOnce({ voice_system_prompt: null, voice_model: null })
      .mockResolvedValueOnce({ business_name: "Tony's Pizzeria" });
    mockResolveVars.mockResolvedValueOnce({ VOICE_TURN_PROFILE: 'pizza shop' });
    const cfg = await resolveVoiceAgentConfig(makeEnv(), '+15553334444');
    expect(cfg.turnDetection.profile).toBe('transactional');
    expect(cfg.turnDetection.minEndpointingDelayMs).toBe(320);
    // No override → default disclosure with the business name substituted.
    expect(cfg.disclosure).toContain("Tony's Pizzeria");
    expect(cfg.disclosure).toContain('may be recorded');
  });
});

describe('resolveVoiceAgentConfig — per-caller memory (roadmap #14/#15)', () => {
  it('recognizes a returning caller from prior completed calls to this site', async () => {
    // dbQueryOne call order: voice_numbers → settings → site → prior-call
    mockQueryOne
      .mockResolvedValueOnce({ site_id: 'site-7', org_id: 'org-1' })
      .mockResolvedValueOnce({ voice_system_prompt: null, voice_model: null })
      .mockResolvedValueOnce({ business_name: 'Acme Dental' })
      .mockResolvedValueOnce({
        summary: 'Asked about a cleaning appointment',
        created_at: '2026-06-20 14:00:00',
        prior_calls: 3,
      });
    const cfg = await resolveVoiceAgentConfig(makeEnv(), '+15551234567', '+15559998888');
    expect(cfg.returningCaller).toEqual({
      known: true,
      priorCalls: 3,
      lastSummary: 'Asked about a cleaning appointment',
      lastCalledAt: '2026-06-20 14:00:00',
    });
  });

  it('returns an unknown caller when no prior call matches', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ site_id: 'site-8', org_id: 'org-1' })
      .mockResolvedValueOnce({ voice_system_prompt: null, voice_model: null })
      .mockResolvedValueOnce({ business_name: 'Acme' })
      .mockResolvedValueOnce(null); // no prior completed call
    const cfg = await resolveVoiceAgentConfig(makeEnv(), '+15551234567', '+15550001111');
    expect(cfg.returningCaller.known).toBe(false);
    expect(cfg.returningCaller.priorCalls).toBe(0);
  });

  it('skips the memory lookup entirely when no caller number is provided', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ site_id: 'site-9', org_id: 'org-1' })
      .mockResolvedValueOnce({ voice_system_prompt: null, voice_model: null })
      .mockResolvedValueOnce({ business_name: 'Acme' });
    const cfg = await resolveVoiceAgentConfig(makeEnv(), '+15551234567');
    expect(cfg.returningCaller.known).toBe(false);
    // 3 queries only (voice_numbers + settings + site) — the prior-call query never ran.
    expect(mockQueryOne).toHaveBeenCalledTimes(3);
  });
});

// ─── route: HMAC gate ───────────────────────────────────────────

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.route('/', voiceWebhookRoutes);
const SECRET = 'internal-secret';

async function hmacHex(body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('POST /internal/voice/agent-config', () => {
  const PATH = '/internal/voice/agent-config';

  it('returns 401 on a bad HMAC signature', async () => {
    const res = await app.request(
      PATH,
      {
        method: 'POST',
        headers: { 'x-internal-sig': 'deadbeef' },
        body: '{"dialedNumber":"+1555"}',
      },
      makeEnv({ INTERNAL_BUILD_SECRET: SECRET }),
    );
    expect(res.status).toBe(401);
  });

  it('returns the resolved config on a valid signature', async () => {
    mockQueryOne.mockResolvedValueOnce(null); // unmapped → platform fallback
    const body = JSON.stringify({ dialedNumber: '+15550000000' });
    const res = await app.request(
      PATH,
      { method: 'POST', headers: { 'x-internal-sig': await hmacHex(body) }, body },
      makeEnv({ INTERNAL_BUILD_SECRET: SECRET }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { found: boolean; llm: { baseUrl: string } };
    expect(json.found).toBe(false);
    expect(json.llm.baseUrl).toBe('https://llm.megabyte.space/v1');
  });
});
