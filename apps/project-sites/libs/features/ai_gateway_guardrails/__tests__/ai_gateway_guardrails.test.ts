import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

import { classify, guardText, FLAG_KEY } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

const mockEnv = {
  AI: { run: jest.fn() },
  DB: { prepare: jest.fn() },
  CACHE_KV: { get: jest.fn(), put: jest.fn() },
} as unknown as Env;

describe('ai_gateway_guardrails', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('ai_gateway_guardrails');
  });

  it('classify() returns safe=true for safe content', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockResolvedValue({ safe: true, score: 0.1, label: null });
    const result = await classify(mockEnv, 'Hello world');
    expect(result.safe).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('classify() blocks when score >= threshold', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockResolvedValue({ safe: false, score: 0.95, label: 'violence' });
    const result = await classify(mockEnv, 'harmful text', 0.85);
    expect(result.safe).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.category).toBe('violence');
  });

  it('classify() fails open when AI throws', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockRejectedValue(new Error('AI down'));
    const result = await classify(mockEnv, 'test');
    expect(result.safe).toBe(true);
    expect(result.blocked).toBe(false);
  });

  it('guardText() returns allowed=true for safe content', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockResolvedValue({ safe: true, score: 0.05 });
    const result = await guardText(mockEnv, 'safe input');
    expect(result.allowed).toBe(true);
  });

  it('guardText() returns allowed=false for unsafe content', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockResolvedValue({ safe: false, score: 0.92, label: 'hate' });
    const result = await guardText(mockEnv, 'bad content', 0.85);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('hate');
  });
});
