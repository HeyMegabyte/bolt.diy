import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../../../../src/prompts/registry', () => ({
  listAll: jest.fn().mockReturnValue([{ id: 'site-gen', version: 2 }]),
  listVersions: jest.fn().mockReturnValue([
    { id: 'site-gen', version: 1 },
    { id: 'site-gen', version: 2 },
  ]),
  configureVariants: jest.fn().mockReturnValue(undefined),
  resolveLatest: jest.fn().mockReturnValue({ id: 'site-gen', version: 2 }),
}));
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

import { listTemplates, setVariantWeights, rollbackToVersion, FLAG_KEY } from '../service.js';

// Access the actual mock registry objects via jest.requireMock so per-test overrides work
// under @swc/jest CJS (casting imported bindings as jest.Mock fails — use requireMock instead)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registryMock = jest.requireMock('../../../../src/prompts/registry') as any;

describe('prompt_studio', () => {
  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('prompt_studio');
  });

  it('listTemplates() returns templates from registry', () => {
    const templates = listTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0]!.id).toBe('site-gen');
    expect(templates[0]!.version).toBe(2);
  });

  it('setVariantWeights() configures variants and returns version', () => {
    const result = setVariantWeights('site-gen', { 'v-a': 0.7, 'v-b': 0.3 });
    expect(result.version).toBe(2);
  });

  it('rollbackToVersion() returns previous version', () => {
    const result = rollbackToVersion('site-gen');
    expect(result.version).toBe(1);
  });

  it('rollbackToVersion() throws when no previous version', () => {
    // Only one entry — no previous version to roll back to
    registryMock.listVersions.mockReturnValueOnce([{ id: 'site-gen', version: 2 }]);
    expect(() => rollbackToVersion('site-gen')).toThrow();
  });
});
