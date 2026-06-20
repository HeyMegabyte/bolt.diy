/**
 * TDD — provider tiers + DeepSeek integration.
 *
 * Validates the new `chooseProviderForTier(env, tier)` export and confirms
 * DeepSeek's default model and base URL are wired correctly.
 *
 * Run: npx jest external_llm_provider_tiers
 */

import {
  chooseProviderForTier,
  DEFAULT_MODELS_EXPORT,
  DIRECT_BASE_URLS_EXPORT,
} from '../services/external_llm.js';

// Minimal Env stub — only the keys relevant to tier resolution
function makeEnv(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    OPENAI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
    DEEPSEEK_API_KEY: undefined,
    ...overrides,
  } as unknown as Record<string, string | undefined>;
}

describe('chooseProviderForTier — premium tier', () => {
  it('returns anthropic when ANTHROPIC_API_KEY is set', () => {
    const env = makeEnv({ ANTHROPIC_API_KEY: 'sk-ant-test', OPENAI_API_KEY: 'sk-openai' });
    expect(chooseProviderForTier(env as never, 'premium')).toBe('anthropic');
  });

  it('falls back to openai when ANTHROPIC_API_KEY is absent', () => {
    const env = makeEnv({ OPENAI_API_KEY: 'sk-openai' });
    expect(chooseProviderForTier(env as never, 'premium')).toBe('openai');
  });

  it('falls back to openai when no keys are set', () => {
    const env = makeEnv();
    expect(chooseProviderForTier(env as never, 'premium')).toBe('openai');
  });
});

describe('chooseProviderForTier — standard tier', () => {
  it('returns deepseek when DEEPSEEK_API_KEY is set', () => {
    const env = makeEnv({ DEEPSEEK_API_KEY: 'sk-ds-test' });
    expect(chooseProviderForTier(env as never, 'standard')).toBe('deepseek');
  });

  it('falls back to openai when DEEPSEEK_API_KEY is absent', () => {
    const env = makeEnv({ OPENAI_API_KEY: 'sk-openai' });
    expect(chooseProviderForTier(env as never, 'standard')).toBe('openai');
  });

  it('falls back to openai when no keys are set', () => {
    const env = makeEnv();
    expect(chooseProviderForTier(env as never, 'standard')).toBe('openai');
  });
});

describe('chooseProviderForTier — instant tier', () => {
  it('returns deepseek when DEEPSEEK_API_KEY is set', () => {
    const env = makeEnv({ DEEPSEEK_API_KEY: 'sk-ds-test' });
    expect(chooseProviderForTier(env as never, 'instant')).toBe('deepseek');
  });

  it('falls back to openai when DEEPSEEK_API_KEY is absent', () => {
    const env = makeEnv({ OPENAI_API_KEY: 'sk-openai' });
    expect(chooseProviderForTier(env as never, 'instant')).toBe('openai');
  });

  it('falls back to openai when no keys are set', () => {
    const env = makeEnv();
    expect(chooseProviderForTier(env as never, 'instant')).toBe('openai');
  });
});

describe('DeepSeek defaults', () => {
  it('DEFAULT_MODELS_EXPORT has deepseek-chat as the default DeepSeek model', () => {
    expect(DEFAULT_MODELS_EXPORT.deepseek).toBe('deepseek-chat');
  });

  it('DIRECT_BASE_URLS_EXPORT has the correct DeepSeek API base URL', () => {
    expect(DIRECT_BASE_URLS_EXPORT.deepseek).toBe('https://api.deepseek.com');
  });
});
