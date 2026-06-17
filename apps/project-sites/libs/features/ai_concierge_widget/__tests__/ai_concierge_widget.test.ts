import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../../../../src/services/rag', () => ({
  semanticSearch: jest.fn().mockResolvedValue([{ id: 'c1', text: 'Website info' }]),
}));
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

import { answer, getConfig, FLAG_KEY } from '../service.js';
import { aiConciergeWidget } from '../handlers.js';

// Access the actual mock objects via jest.requireMock so we can assert/override per-test
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const flagsMock = jest.requireMock('../../../../src/modules/feature_flags/services.js') as any;

const mockEnv = {
  AI: { run: jest.fn().mockResolvedValue({ response: 'Hello from AI' }) },
  DB: { prepare: jest.fn() },
  CACHE_KV: { get: jest.fn(), put: jest.fn() },
  PROMPT_STORE: { get: jest.fn(), put: jest.fn() },
} as unknown as import('../../../../src/types/env.js').Env;

describe('ai_concierge_widget', () => {
  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('ai_concierge_widget');
  });

  it('answer() returns a reply grounded on RAG chunks', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockResolvedValue({ response: 'Hello from AI' });
    const result = await answer(mockEnv, 'site-abc', 'What do you do?');
    expect(result.reply).toBe('Hello from AI');
    expect(result.groundedOn).toContain('c1');
  });

  it('answer() falls back gracefully when AI throws', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockRejectedValue(new Error('AI down'));
    const result = await answer(mockEnv, 'site-abc', 'test');
    expect(result.reply).toBeTruthy();
  });

  it('getConfig() returns siteId and greeting', async () => {
    const cfg = await getConfig('site-abc');
    expect(cfg.siteId).toBe('site-abc');
    expect(cfg.greeting).toBeTruthy();
  });

  it('POST /api/concierge/:siteId/message returns 401 without userId', async () => {
    const req = new Request('http://localhost/api/concierge/site1/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello' }),
    });
    const res = await aiConciergeWidget.fetch(req, mockEnv);
    expect(res.status).toBe(401);
  });

  it('POST /api/concierge/:siteId/message FLAG_KEY is correct', () => {
    // Structural invariant — flag key is stable
    expect(flagsMock.isFlagOn).toBeDefined();
    expect(FLAG_KEY).toBe('ai_concierge_widget');
  });
});
