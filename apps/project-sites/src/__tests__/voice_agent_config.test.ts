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
import { resolveVoiceAgentConfig } from '../services/voice_agent_config.js';
import { voiceWebhookRoutes } from '../routes/voice_webhooks.js';

const mockQueryOne = dbQueryOne as unknown as jest.Mock;
const mockResolveVars = resolveEnvVarsForAI as unknown as jest.Mock;

const PLATFORM = { LITELLM_BASE_URL: 'https://llm.megabyte.space/v1', LITELLM_API_KEY: 'sk-platform' };

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
      model: 'gpt-4o-mini',
    });
    expect(cfg.persona).toContain('receptionist');
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
      { method: 'POST', headers: { 'x-internal-sig': 'deadbeef' }, body: '{"dialedNumber":"+1555"}' },
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
