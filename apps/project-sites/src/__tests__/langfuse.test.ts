import type { Env } from '../types/env.js';
import { captureLangfuseGeneration, isLangfuseConfigured } from '../lib/langfuse.js';

const mockFetch = jest.fn().mockResolvedValue({ ok: true });
(global as any).fetch = mockFetch;

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    LANGFUSE_BASE_URL: 'https://langfuse.projectsites.dev',
    LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
    LANGFUSE_SECRET_KEY: 'sk-lf-test',
    ...overrides,
  } as unknown as Env;
}

const OK_CALL = {
  distinctId: 'org-1',
  provider: 'deepseek',
  model: 'deepseek-chat',
  promptId: 'research_brand',
  inputTokens: 800,
  outputTokens: 400,
  latencyMs: 1200,
  costUsd: 0.0004,
  status: 'ok',
  traceId: 'trace-abc',
} as const;

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── isLangfuseConfigured ─────────────────────────────────────

describe('isLangfuseConfigured', () => {
  it('true when all three secrets present', () => {
    expect(isLangfuseConfigured(makeEnv())).toBe(true);
  });

  it('false when base url missing', () => {
    expect(isLangfuseConfigured(makeEnv({ LANGFUSE_BASE_URL: undefined }))).toBe(false);
  });

  it('false when public key missing', () => {
    expect(isLangfuseConfigured(makeEnv({ LANGFUSE_PUBLIC_KEY: undefined }))).toBe(false);
  });

  it('false when secret key missing', () => {
    expect(isLangfuseConfigured(makeEnv({ LANGFUSE_SECRET_KEY: undefined }))).toBe(false);
  });
});

// ─── captureLangfuseGeneration — no-op gates ──────────────────

describe('captureLangfuseGeneration — unconfigured no-op', () => {
  it('does not fetch when base url unset', async () => {
    await captureLangfuseGeneration(makeEnv({ LANGFUSE_BASE_URL: undefined }), { ...OK_CALL });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when public key unset', async () => {
    await captureLangfuseGeneration(makeEnv({ LANGFUSE_PUBLIC_KEY: undefined }), { ...OK_CALL });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not fetch when secret key unset', async () => {
    await captureLangfuseGeneration(makeEnv({ LANGFUSE_SECRET_KEY: undefined }), { ...OK_CALL });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── captureLangfuseGeneration — ingestion shape ──────────────

describe('captureLangfuseGeneration — ingestion request', () => {
  it('POSTs to the /api/public/ingestion endpoint with Basic auth', async () => {
    await captureLangfuseGeneration(makeEnv(), { ...OK_CALL });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://langfuse.projectsites.dev/api/public/ingestion');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    // Basic base64(pk:sk)
    expect(options.headers.Authorization).toBe(`Basic ${btoa('pk-lf-test:sk-lf-test')}`);
  });

  it('strips a trailing slash on the base url', async () => {
    await captureLangfuseGeneration(makeEnv({ LANGFUSE_BASE_URL: 'https://lf.example.com/' }), {
      ...OK_CALL,
    });
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://lf.example.com/api/public/ingestion');
  });

  it('sends a trace-create + generation-create batch', async () => {
    await captureLangfuseGeneration(makeEnv(), { ...OK_CALL });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(Array.isArray(body.batch)).toBe(true);
    expect(body.batch).toHaveLength(2);
    expect(body.batch[0].type).toBe('trace-create');
    expect(body.batch[1].type).toBe('generation-create');
  });

  it('carries model, provider, token usage, and cost on the generation', async () => {
    await captureLangfuseGeneration(makeEnv(), { ...OK_CALL });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const gen = body.batch[1].body;
    expect(gen.model).toBe('deepseek-chat');
    expect(gen.name).toBe('research_brand');
    expect(gen.usage.input).toBe(800);
    expect(gen.usage.output).toBe(400);
    expect(gen.usage.total).toBe(1200);
    expect(gen.usage.unit).toBe('TOKENS');
    expect(gen.usage.totalCost).toBe(0.0004);
    expect(gen.metadata.provider).toBe('deepseek');
    expect(gen.level).toBe('DEFAULT');
  });

  it('threads the provided traceId onto both the trace and the generation', async () => {
    await captureLangfuseGeneration(makeEnv(), { ...OK_CALL });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.batch[0].body.id).toBe('trace-abc');
    expect(body.batch[1].body.traceId).toBe('trace-abc');
  });

  it('marks an error call level=ERROR with a statusMessage', async () => {
    await captureLangfuseGeneration(makeEnv(), {
      ...OK_CALL,
      status: 'error',
      errorMessage: 'upstream 500',
    });

    const gen = JSON.parse(mockFetch.mock.calls[0][1].body).batch[1].body;
    expect(gen.level).toBe('ERROR');
    expect(gen.statusMessage).toBe('upstream 500');
  });

  it('falls back to provider:model as the trace name when promptId absent', async () => {
    await captureLangfuseGeneration(makeEnv(), { ...OK_CALL, promptId: undefined });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.batch[0].body.name).toBe('deepseek:deepseek-chat');
  });

  it('mints a traceId when none supplied', async () => {
    await captureLangfuseGeneration(makeEnv(), { ...OK_CALL, traceId: undefined });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(typeof body.batch[0].body.id).toBe('string');
    expect(body.batch[0].body.id.length).toBeGreaterThan(0);
    expect(body.batch[1].body.traceId).toBe(body.batch[0].body.id);
  });

  it('defaults token/cost fields to zero when omitted', async () => {
    await captureLangfuseGeneration(makeEnv(), {
      distinctId: 'org-2',
      provider: 'workers_ai',
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      latencyMs: 50,
      status: 'ok',
    });

    const gen = JSON.parse(mockFetch.mock.calls[0][1].body).batch[1].body;
    expect(gen.usage.input).toBe(0);
    expect(gen.usage.output).toBe(0);
    expect(gen.usage.total).toBe(0);
    expect(gen.usage.totalCost).toBe(0);
  });
});

// ─── captureLangfuseGeneration — fail-soft ────────────────────

describe('captureLangfuseGeneration — fail-soft', () => {
  it('does not throw when fetch rejects', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));
    await expect(captureLangfuseGeneration(makeEnv(), { ...OK_CALL })).resolves.toBeUndefined();
  });
});
