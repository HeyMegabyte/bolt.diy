import { describe, it, expect, beforeEach } from '@jest/globals';

// Use the REAL prompt registry seeded via register()/clearRegistry() — NOT a
// jest.mock of it. @swc/jest's jest.mock hoist does not reliably intercept the
// registry module here (the prior mock returned the real empty registry → all
// data assertions failed). The registry is a controllable in-memory singleton,
// so seeding it directly is the @swc/jest-proof pattern (mirrors the passing
// src/__tests__/prompt_registry.test.ts). See _LOOP_LEDGER fire-v2.43.
import { register, clearRegistry } from '../../../../src/prompts/registry.js';
import type { PromptSpec } from '../../../../src/prompts/types.js';
import { listTemplates, setVariantWeights, rollbackToVersion, FLAG_KEY } from '../service.js';

function makeSpec(overrides?: Partial<PromptSpec>): PromptSpec {
  return {
    id: 'site-gen',
    version: 1,
    description: 'A site-generation prompt',
    models: ['gpt-4'],
    params: { temperature: 0.7, maxTokens: 1024 },
    inputs: { required: ['query'], optional: ['context'] },
    outputs: { format: 'json', schema: 'SiteSchema' },
    notes: { quality: 'experimental' },
    system: 'You are a site generator.',
    user: 'Generate: {{query}}',
    ...overrides,
  };
}

describe('prompt_studio', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('prompt_studio');
  });

  it('listTemplates() returns templates from registry', () => {
    register(makeSpec({ version: 2 }));

    const templates = listTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.id).toBe('site-gen');
    expect(templates[0]!.version).toBe(2);
  });

  it('setVariantWeights() configures variants and returns the latest version', () => {
    register(makeSpec({ version: 2 }));

    // Registry contract: variant weights are percentages and must sum to 100.
    const result = setVariantWeights('site-gen', { 'v-a': 70, 'v-b': 30 });
    expect(result.version).toBe(2);
  });

  it('setVariantWeights() throws when the prompt key is unknown', () => {
    expect(() => setVariantWeights('does-not-exist', { a: 1 })).toThrow();
  });

  it('rollbackToVersion() returns the previous version', () => {
    register(makeSpec({ version: 1 }));
    register(makeSpec({ version: 2 }));

    const result = rollbackToVersion('site-gen');
    expect(result.version).toBe(1);
  });

  it('rollbackToVersion() throws when there is no previous version', () => {
    register(makeSpec({ version: 2 })); // only one version registered

    expect(() => rollbackToVersion('site-gen')).toThrow();
  });
});
