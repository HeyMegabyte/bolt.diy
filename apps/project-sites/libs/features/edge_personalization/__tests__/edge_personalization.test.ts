import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../../../../src/services/db', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [] }),
  dbExecute: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

import { upsertVariants, resolveVariant, FLAG_KEY } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

const mockEnv = {
  DB: { prepare: jest.fn() },
  CACHE_KV: { get: jest.fn(), put: jest.fn() },
} as unknown as Env;

// Access the actual mock registry objects so per-test overrides work under @swc/jest CJS
// (casting imported bindings as jest.Mock fails — use requireMock instead)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbMock = jest.requireMock('../../../../src/services/db') as any;

describe('edge_personalization', () => {
  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('edge_personalization');
  });

  it('upsertVariants() calls dbExecute for each variant', async () => {
    const count = await upsertVariants(mockEnv, 'site1', [
      { id: 'v1', name: 'Mobile', conditions: { device: 'mobile' }, priority: 10 },
    ]);
    expect(count).toBe(1);
  });

  it('resolveVariant() returns default when no variants match', async () => {
    const result = await resolveVariant(mockEnv, 'site1', { device: 'desktop' });
    expect(result.variantId).toBe('default');
  });

  it('resolveVariant() matches mobile device condition', async () => {
    dbMock.dbQuery.mockResolvedValueOnce({
      data: [{ id: 'v1', name: 'Mobile', conditions: '{"device":"mobile"}', priority: 10 }],
    });
    const result = await resolveVariant(mockEnv, 'site1', { device: 'mobile' });
    expect(result.variantId).toBe('v1');
    expect(result.variantName).toBe('Mobile');
  });

  it('resolveVariant() returns default on DB error', async () => {
    dbMock.dbQuery.mockRejectedValueOnce(new Error('DB down'));
    const result = await resolveVariant(mockEnv, 'site1', {});
    expect(result.variantId).toBe('default');
  });
});
