/**
 * Unit tests for the cmdk_ai_actions feature module.
 *
 * Uses Jest (not Vitest) per the project's test configuration.
 * Workers AI (env.AI) is mocked — no real LLM calls are made.
 */

import { CmdkResolveBodySchema, CmdkResolveResponseSchema, ResolvedActionSchema } from '../schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AiMock = { run: jest.Mock };

/** Build a minimal fake Env with a mocked AI binding. */
function makeEnv(aiOverride?: AiMock): Record<string, unknown> {
  return {
    AI: aiOverride ?? {
      run: jest.fn().mockResolvedValue({
        response: JSON.stringify({
          action: 'navigate',
          target: '/admin/sites',
          label: 'Go to Sites',
          confidence: 0.95,
        }),
      }),
    },
  };
}

/** Build a minimal successful Workers AI response for a given action. */
function aiResponse(action: string, target?: string, confidence = 0.9) {
  return {
    response: JSON.stringify({ action, target, label: `Do ${action}`, confidence }),
  };
}

// ---------------------------------------------------------------------------
// Schema tests — CmdkResolveBodySchema
// ---------------------------------------------------------------------------

describe('CmdkResolveBodySchema', () => {
  it('accepts a valid query', () => {
    const result = CmdkResolveBodySchema.safeParse({ query: 'go to settings' });
    expect(result.success).toBe(true);
  });

  it('accepts query with full context', () => {
    const result = CmdkResolveBodySchema.safeParse({
      query: 'publish',
      context: { route: '/admin/sites', siteSlug: 'my-site', hint: 'drafts ready' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts query with no context', () => {
    const result = CmdkResolveBodySchema.safeParse({ query: 'view analytics' });
    expect(result.success).toBe(true);
  });

  it('rejects empty query', () => {
    const result = CmdkResolveBodySchema.safeParse({ query: '' });
    expect(result.success).toBe(false);
  });

  it('rejects query over 512 characters', () => {
    const result = CmdkResolveBodySchema.safeParse({ query: 'a'.repeat(513) });
    expect(result.success).toBe(false);
  });

  it('rejects hint over 256 characters', () => {
    const result = CmdkResolveBodySchema.safeParse({
      query: 'something',
      context: { hint: 'x'.repeat(257) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing query', () => {
    const result = CmdkResolveBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Schema tests — ResolvedActionSchema
// ---------------------------------------------------------------------------

describe('ResolvedActionSchema', () => {
  it('accepts all valid action tokens', () => {
    const tokens = [
      'navigate', 'create_site', 'open_settings', 'search',
      'publish_site', 'view_analytics', 'manage_domains', 'open_docs', 'unknown',
    ];
    for (const action of tokens) {
      const result = ResolvedActionSchema.safeParse({ action, label: 'Test', confidence: 0.5 });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an unknown action token', () => {
    const result = ResolvedActionSchema.safeParse({ action: 'delete_everything', label: 'Test', confidence: 0.9 });
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 1', () => {
    const result = ResolvedActionSchema.safeParse({ action: 'navigate', label: 'Test', confidence: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects confidence below 0', () => {
    const result = ResolvedActionSchema.safeParse({ action: 'navigate', label: 'Test', confidence: -0.1 });
    expect(result.success).toBe(false);
  });

  it('accepts a response without target', () => {
    const result = ResolvedActionSchema.safeParse({ action: 'unknown', label: 'Unknown', confidence: 0 });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema tests — CmdkResolveResponseSchema
// ---------------------------------------------------------------------------

describe('CmdkResolveResponseSchema', () => {
  it('parses a valid success response', () => {
    const result = CmdkResolveResponseSchema.safeParse({
      ok: true,
      data: { action: 'navigate', target: '/admin', label: 'Admin', confidence: 0.8 },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service tests — resolveNlAction
// ---------------------------------------------------------------------------

describe('resolveNlAction', () => {
  let resolveNlAction: (env: unknown, query: string, ctx?: unknown) => Promise<unknown>;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function loadService() {
    const mod = await import('../service.js');
    resolveNlAction = mod.resolveNlAction as typeof resolveNlAction;
  }

  it('returns a resolved action for a valid query', async () => {
    const aiMock: AiMock = { run: jest.fn().mockResolvedValue(aiResponse('view_analytics', '/admin/analytics')) };
    await loadService();

    const result = (await resolveNlAction(makeEnv(aiMock), 'show analytics')) as Record<string, unknown>;
    expect(result['action']).toBe('view_analytics');
    expect(result['confidence']).toBeGreaterThan(0);
  });

  it('returns fallback unknown action when AI binding is missing', async () => {
    await loadService();
    const result = (await resolveNlAction({ AI: undefined }, 'something')) as Record<string, unknown>;
    expect(result['action']).toBe('unknown');
    expect(result['confidence']).toBe(0);
  });

  it('returns fallback unknown action when AI returns empty response', async () => {
    const aiMock: AiMock = { run: jest.fn().mockResolvedValue({ response: '' }) };
    await loadService();

    const result = (await resolveNlAction(makeEnv(aiMock), 'something')) as Record<string, unknown>;
    expect(result['action']).toBe('unknown');
  });

  it('returns fallback when AI returns invalid JSON', async () => {
    const aiMock: AiMock = { run: jest.fn().mockResolvedValue({ response: 'not json' }) };
    await loadService();

    const result = (await resolveNlAction(makeEnv(aiMock), 'something')) as Record<string, unknown>;
    expect(result['action']).toBe('unknown');
  });

  it('returns fallback when AI returns JSON that fails schema validation', async () => {
    const aiMock: AiMock = {
      run: jest.fn().mockResolvedValue({ response: JSON.stringify({ action: 'delete_everything', confidence: 2 }) }),
    };
    await loadService();

    const result = (await resolveNlAction(makeEnv(aiMock), 'something')) as Record<string, unknown>;
    expect(result['action']).toBe('unknown');
  });

  it('returns fallback when AI run() throws', async () => {
    const aiMock: AiMock = { run: jest.fn().mockRejectedValue(new Error('quota exceeded')) };
    await loadService();

    const result = (await resolveNlAction(makeEnv(aiMock), 'something')) as Record<string, unknown>;
    expect(result['action']).toBe('unknown');
  });

  it('passes the correct model identifier to env.AI.run', async () => {
    const aiMock: AiMock = { run: jest.fn().mockResolvedValue(aiResponse('navigate')) };
    await loadService();

    await resolveNlAction(makeEnv(aiMock), 'go home');
    expect(aiMock.run).toHaveBeenCalledWith(
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      expect.objectContaining({ messages: expect.any(Array) }),
    );
  });

  it('includes the query in the user message sent to AI', async () => {
    const aiMock: AiMock = { run: jest.fn().mockResolvedValue(aiResponse('navigate')) };
    await loadService();

    await resolveNlAction(makeEnv(aiMock), 'open billing');
    const [, inputs] = aiMock.run.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }];
    const userMsg = inputs.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('open billing');
  });

  it('includes context route in the user message when supplied', async () => {
    const aiMock: AiMock = { run: jest.fn().mockResolvedValue(aiResponse('navigate')) };
    await loadService();

    await resolveNlAction(makeEnv(aiMock), 'go to analytics', { route: '/admin/sites' });
    const [, inputs] = aiMock.run.mock.calls[0] as [string, { messages: Array<{ role: string; content: string }> }];
    const userMsg = inputs.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('/admin/sites');
  });

  it('strips markdown code fences from LLM output', async () => {
    const fencedResponse = '```json\n' + JSON.stringify(aiResponse('open_settings').response ? JSON.parse(aiResponse('open_settings').response) : {}) + '\n```';
    const aiMock: AiMock = { run: jest.fn().mockResolvedValue({ response: fencedResponse }) };
    await loadService();

    const result = (await resolveNlAction(makeEnv(aiMock), 'settings')) as Record<string, unknown>;
    expect(result['action']).toBe('open_settings');
  });
});

// ---------------------------------------------------------------------------
// FLAG_KEY export
// ---------------------------------------------------------------------------

describe('FLAG_KEY', () => {
  it('exports the expected flag key string', async () => {
    const { FLAG_KEY } = await import('../service.js');
    expect(FLAG_KEY).toBe('cmdk_ai_actions');
  });
});
