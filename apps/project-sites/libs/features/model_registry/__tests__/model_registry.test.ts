/**
 * Tests for the model_registry feature module.
 * Covers: service unit tests, flag-off 404, flag-on full list,
 * availability logic per-alias, provider env-key checks.
 */
import { Hono } from 'hono';

const mockIsFlagOn = jest.fn();
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: (...a: unknown[]) => mockIsFlagOn(...a),
}));

import { MODEL_ALIASES, PROVIDERS, aliasAvailable, providerAvailable, FLAG_KEY } from '../service.js';
import { modelRegistry } from '../handlers.js';

// ---------------------------------------------------------------------------
// App factory — mounts modelRegistry at root (the handler owns the /v1/models path)
// ---------------------------------------------------------------------------
function app(envOverrides: Record<string, unknown> = {}) {
  const a = new Hono();
  a.route('/', modelRegistry);
  return {
    request: (path: string, init?: RequestInit) =>
      a.request(path, init, envOverrides as never, {
        waitUntil() {},
        passThroughOnException() {},
      } as never),
  };
}

const GET = (envOverrides: Record<string, unknown> = {}) =>
  app(envOverrides).request('/v1/models', { method: 'GET' });

beforeEach(() => {
  mockIsFlagOn.mockReset();
});

// ---------------------------------------------------------------------------
// 1. Service unit tests — providerAvailable
// ---------------------------------------------------------------------------
describe('providerAvailable()', () => {
  it('returns false for unknown provider id', () => {
    expect(providerAvailable({}, 'nonexistent')).toBe(false);
  });

  it('returns false for deepseek when DEEPSEEK_API_KEY is missing', () => {
    expect(providerAvailable({}, 'deepseek')).toBe(false);
  });

  it('returns true for deepseek when DEEPSEEK_API_KEY is set', () => {
    expect(providerAvailable({ DEEPSEEK_API_KEY: 'sk-xxx' }, 'deepseek')).toBe(true);
  });

  it('returns false for anthropic when ANTHROPIC_API_KEY is missing', () => {
    expect(providerAvailable({}, 'anthropic')).toBe(false);
  });

  it('returns true for anthropic when ANTHROPIC_API_KEY is set', () => {
    expect(providerAvailable({ ANTHROPIC_API_KEY: 'sk-ant-xxx' }, 'anthropic')).toBe(true);
  });

  it('returns false for workers-ai when AI binding is absent', () => {
    expect(providerAvailable({}, 'workers-ai')).toBe(false);
  });

  it('returns true for workers-ai when AI binding is present', () => {
    expect(providerAvailable({ AI: {} }, 'workers-ai')).toBe(true);
  });

  it('returns false for ollama when OLLAMA_BASE_URL is missing', () => {
    expect(providerAvailable({}, 'ollama')).toBe(false);
  });

  it('returns true for ollama when OLLAMA_BASE_URL is set', () => {
    expect(providerAvailable({ OLLAMA_BASE_URL: 'http://localhost:11434' }, 'ollama')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Service unit tests — aliasAvailable
// ---------------------------------------------------------------------------
describe('aliasAvailable()', () => {
  const edgeFast = MODEL_ALIASES.find((a) => a.id === 'edge-fast')!;
  const premiumQuorum = MODEL_ALIASES.find((a) => a.id === 'premium-quorum')!;
  const deepseekFast = MODEL_ALIASES.find((a) => a.id === 'deepseek-fast')!;
  const claudeArchitect = MODEL_ALIASES.find((a) => a.id === 'claude-architect')!;

  it('edge-fast is unavailable when AI binding is absent', () => {
    expect(aliasAvailable({}, edgeFast)).toBe(false);
  });

  it('edge-fast is available when AI binding is present', () => {
    expect(aliasAvailable({ AI: {} }, edgeFast)).toBe(true);
  });

  it('premium-quorum is unavailable when no provider key is set', () => {
    expect(aliasAvailable({}, premiumQuorum)).toBe(false);
  });

  it('premium-quorum is available when anthropic key is set', () => {
    expect(aliasAvailable({ ANTHROPIC_API_KEY: 'x' }, premiumQuorum)).toBe(true);
  });

  it('premium-quorum is available when only deepseek key is set', () => {
    expect(aliasAvailable({ DEEPSEEK_API_KEY: 'x' }, premiumQuorum)).toBe(true);
  });

  it('deepseek-fast is available when DEEPSEEK_API_KEY set', () => {
    expect(aliasAvailable({ DEEPSEEK_API_KEY: 'x' }, deepseekFast)).toBe(true);
  });

  it('claude-architect is unavailable without ANTHROPIC_API_KEY', () => {
    expect(aliasAvailable({}, claudeArchitect)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Flag off → 404
// ---------------------------------------------------------------------------
describe('GET /v1/models — flag gate', () => {
  it('returns 404 when the model_registry flag is off', async () => {
    mockIsFlagOn.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// 4. Flag on → full list
// ---------------------------------------------------------------------------
describe('GET /v1/models — flag on, no env keys', () => {
  it('returns 200 with object:list', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json() as { object: string; data: unknown[] };
    expect(body.object).toBe('list');
  });

  it('data includes all 13 expected alias ids', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET();
    const body = await res.json() as { data: Array<{ id: string }> };
    const ids = body.data.map((d) => d.id);
    expect(ids).toContain('deepseek-fast');
    expect(ids).toContain('deepseek-code');
    expect(ids).toContain('premium-quorum');
    expect(ids).toContain('grok-live-business');
    expect(ids).toContain('gemini-grounded');
    expect(ids).toContain('edge-fast');
    expect(ids).toContain('claude-architect');
    expect(ids).toHaveLength(13);
  });

  it('each entry has object:model and required fields', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET();
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    for (const entry of body.data) {
      expect(entry.object).toBe('model');
      expect(entry.owned_by).toBe('projectsites');
      expect(entry.created).toBe(0);
      expect(typeof entry._available).toBe('boolean');
      expect(Array.isArray(entry._providers)).toBe(true);
      expect(typeof entry._tier).toBe('string');
    }
  });

  it('premium aliases are _available:false with no env keys', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET(); // env = {}
    const body = await res.json() as { data: Array<{ id: string; _available: boolean }> };
    const premiumQuorum = body.data.find((d) => d.id === 'premium-quorum')!;
    expect(premiumQuorum._available).toBe(false);
    const claudeArchitect = body.data.find((d) => d.id === 'claude-architect')!;
    expect(claudeArchitect._available).toBe(false);
  });

  it('edge aliases reflect AI binding absence', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET(); // no AI binding
    const body = await res.json() as { data: Array<{ id: string; _available: boolean }> };
    const edgeFast = body.data.find((d) => d.id === 'edge-fast')!;
    expect(edgeFast._available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Availability reflected correctly when env keys provided
// ---------------------------------------------------------------------------
describe('GET /v1/models — with provider env keys', () => {
  it('deepseek-fast is _available:true when DEEPSEEK_API_KEY set', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET({ DEEPSEEK_API_KEY: 'sk-deepseek-test' });
    const body = await res.json() as { data: Array<{ id: string; _available: boolean }> };
    const entry = body.data.find((d) => d.id === 'deepseek-fast')!;
    expect(entry._available).toBe(true);
  });

  it('edge-fast is _available:true when AI binding present', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET({ AI: { run: () => {} } });
    const body = await res.json() as { data: Array<{ id: string; _available: boolean }> };
    const entry = body.data.find((d) => d.id === 'edge-fast')!;
    expect(entry._available).toBe(true);
  });

  it('premium-quorum is _available:true when only OPENAI_API_KEY set', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET({ OPENAI_API_KEY: 'sk-openai-test' });
    const body = await res.json() as { data: Array<{ id: string; _available: boolean }> };
    const entry = body.data.find((d) => d.id === 'premium-quorum')!;
    expect(entry._available).toBe(true);
  });

  it('grok-live-business is _available:true when XAI_API_KEY set', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET({ XAI_API_KEY: 'sk-xai-test' });
    const body = await res.json() as { data: Array<{ id: string; _available: boolean }> };
    const entry = body.data.find((d) => d.id === 'grok-live-business')!;
    expect(entry._available).toBe(true);
  });

  it('claude-architect is _available:true when ANTHROPIC_API_KEY set', async () => {
    mockIsFlagOn.mockResolvedValue(true);
    const res = await GET({ ANTHROPIC_API_KEY: 'sk-ant-test' });
    const body = await res.json() as { data: Array<{ id: string; _available: boolean }> };
    const entry = body.data.find((d) => d.id === 'claude-architect')!;
    expect(entry._available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Registry integrity
// ---------------------------------------------------------------------------
describe('Registry integrity', () => {
  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('model_registry');
  });

  it('PROVIDERS has exactly 8 entries with unique ids', () => {
    expect(PROVIDERS).toHaveLength(8);
    const ids = new Set(PROVIDERS.map((p) => p.id));
    expect(ids.size).toBe(8);
  });

  it('MODEL_ALIASES has exactly 13 entries with unique ids', () => {
    expect(MODEL_ALIASES).toHaveLength(13);
    const ids = new Set(MODEL_ALIASES.map((a) => a.id));
    expect(ids.size).toBe(13);
  });

  it('every alias.providers entry maps to a known provider id', () => {
    const providerIds = new Set(PROVIDERS.map((p) => p.id));
    for (const alias of MODEL_ALIASES) {
      for (const pid of alias.providers) {
        expect(providerIds.has(pid)).toBe(true);
      }
    }
  });
});
