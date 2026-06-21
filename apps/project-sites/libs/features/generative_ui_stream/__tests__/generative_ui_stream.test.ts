import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

import { generateUiDescriptors, FLAG_KEY } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

const validJson = JSON.stringify([{ component: 'HeroSection', props: { title: 'Hello' } }]);

const mockEnv = {
  AI: { run: jest.fn().mockResolvedValue({ response: validJson }) },
  DB: { prepare: jest.fn() },
  CACHE_KV: { get: jest.fn(), put: jest.fn() },
} as unknown as Env;

describe('generative_ui_stream', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('generative_ui_stream');
  });

  it('generateUiDescriptors() parses valid LLM JSON response', async () => {
    const result = await generateUiDescriptors(mockEnv, 'Create a hero section');
    expect(result).toHaveLength(1);
    expect(result[0]!.component).toBe('HeroSection');
    expect(result[0]!.props).toEqual({ title: 'Hello' });
  });

  it('generateUiDescriptors() returns fallback on AI error', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockRejectedValue(new Error('AI down'));
    const result = await generateUiDescriptors(mockEnv, 'test');
    expect(result).toHaveLength(1);
    expect(result[0]!.component).toBe('TextBlock');
  });

  it('generateUiDescriptors() returns fallback on invalid JSON', async () => {
    (mockEnv.AI as { run: jest.Mock }).run = jest.fn().mockResolvedValue({ response: 'not json' });
    const result = await generateUiDescriptors(mockEnv, 'test');
    expect(result[0]!.component).toBe('TextBlock');
  });
});
