import type { Env } from '../types/env.js';

// Mock the analytics hook so we assert what the helper *reports* without a real fetch.
// The factory references ONLY the global `jest.fn()` (never an outer variable) so it is
// safe under @swc/jest hoisting — which does NOT replicate babel's `mock`-prefix
// allowlist (see apps/project-sites/CLAUDE.md gotcha #12). Retrieve the mock via import.
jest.mock('../services/analytics.js', () => ({ captureLLMCall: jest.fn() }));

import { captureLLMCall } from '../services/analytics.js';
import { runObservedWorkersAI } from '../lib/workers_ai.js';

const mockCaptureLLMCall = captureLLMCall as jest.Mock;

function makeEnv(run: jest.Mock): Env {
  return { AI: { run } } as unknown as Env;
}

const MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';
const INPUTS = { messages: [{ role: 'user', content: 'hi there' }], max_tokens: 30 };
const META = { distinctId: 'org-1', promptId: 'ai_categorize', traceId: 'req-1' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCaptureLLMCall.mockResolvedValue(undefined);
});

describe('runObservedWorkersAI', () => {
  it('returns the raw env.AI.run result unchanged', async () => {
    const run = jest.fn().mockResolvedValue({ response: 'Salon / Barbershop' });
    const result = await runObservedWorkersAI(makeEnv(run), MODEL, INPUTS, META);
    expect(result).toEqual({ response: 'Salon / Barbershop' });
    expect(run).toHaveBeenCalledWith(MODEL, INPUTS);
  });

  it('reports an observed workers_ai generation with model + correlation + zero cost', async () => {
    const run = jest.fn().mockResolvedValue({ response: 'ok' });
    await runObservedWorkersAI(makeEnv(run), MODEL, INPUTS, META);

    expect(mockCaptureLLMCall).toHaveBeenCalledTimes(1);
    const params = mockCaptureLLMCall.mock.calls[0][1];
    expect(params.provider).toBe('workers_ai');
    expect(params.model).toBe(MODEL);
    expect(params.promptId).toBe('ai_categorize');
    expect(params.traceId).toBe('req-1');
    expect(params.distinctId).toBe('org-1');
    expect(params.status).toBe('ok');
    expect(params.costUsd).toBe(0);
    expect(params.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('prefers the model usage block over the char/4 estimate when present', async () => {
    const run = jest.fn().mockResolvedValue({
      response: 'ok',
      usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 },
    });
    await runObservedWorkersAI(makeEnv(run), MODEL, INPUTS, META);

    const params = mockCaptureLLMCall.mock.calls[0][1];
    expect(params.inputTokens).toBe(123);
    expect(params.outputTokens).toBe(45);
  });

  it('estimates tokens (~chars/4) when the model returns no usage block', async () => {
    const run = jest.fn().mockResolvedValue({ response: 'abcdefgh' }); // 8 chars → 2 tokens
    await runObservedWorkersAI(makeEnv(run), MODEL, INPUTS, META);

    const params = mockCaptureLLMCall.mock.calls[0][1];
    expect(params.outputTokens).toBe(2);
    expect(params.inputTokens).toBeGreaterThan(0);
  });

  it('reports status=error and re-throws when env.AI.run throws', async () => {
    const run = jest.fn().mockRejectedValue(new Error('AI binding down'));
    await expect(runObservedWorkersAI(makeEnv(run), MODEL, INPUTS, META)).rejects.toThrow(
      'AI binding down',
    );

    const params = mockCaptureLLMCall.mock.calls[0][1];
    expect(params.status).toBe('error');
    expect(params.errorMessage).toBe('AI binding down');
    expect(params.outputTokens).toBe(0);
  });

  it('is fail-soft: an observability failure never breaks the AI call', async () => {
    mockCaptureLLMCall.mockRejectedValueOnce(new Error('posthog down'));
    const run = jest.fn().mockResolvedValue({ response: 'still returned' });
    const result = await runObservedWorkersAI(makeEnv(run), MODEL, INPUTS, META);
    expect(result).toEqual({ response: 'still returned' });
  });
});
