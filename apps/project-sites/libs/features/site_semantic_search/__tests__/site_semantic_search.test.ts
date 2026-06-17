import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../../../../src/services/rag', () => ({
  semanticSearch: jest.fn().mockResolvedValue([{ id: 'r1', text: 'Result text', score: 0.9 }]),
  indexChunk: jest.fn().mockResolvedValue(undefined),
  deleteIndex: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../../../src/modules/feature_flags/services.js', () => ({
  isFlagOn: jest.fn().mockResolvedValue(true),
}));

import { querySearch, reindexSite, FLAG_KEY } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

const mockEnv = {
  AI: { run: jest.fn() },
  DB: { prepare: jest.fn() },
  CACHE_KV: { get: jest.fn(), put: jest.fn() },
  RAG_INDEX: {},
} as unknown as Env;

// Access the actual mock objects via jest.requireMock so we can override per-test
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ragMock = jest.requireMock('../../../../src/services/rag') as any;

describe('site_semantic_search', () => {
  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('site_semantic_search');
  });

  it('querySearch() returns results from semanticSearch', async () => {
    ragMock.semanticSearch.mockResolvedValue([{ id: 'r1', text: 'Result text', score: 0.9 }]);
    const results = await querySearch(mockEnv, 'site-abc', 'test query', 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('r1');
    expect(results[0]!.text).toBe('Result text');
  });

  it('querySearch() returns empty array on RAG error', async () => {
    ragMock.semanticSearch.mockRejectedValueOnce(new Error('RAG down'));
    const results = await querySearch(mockEnv, 'site-abc', 'test', 5);
    expect(results).toEqual([]);
  });

  it('reindexSite() indexes chunks and returns count', async () => {
    const count = await reindexSite(mockEnv, 'site-abc', {
      chunks: [
        { id: 'c1', text: 'chunk one' },
        { id: 'c2', text: 'chunk two' },
      ],
    });
    expect(count).toBe(2);
  });
});
