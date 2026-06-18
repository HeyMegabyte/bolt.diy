import { describe, it, expect } from '@jest/globals';

// No jest.mock of services/rag (@swc/jest's hoist doesn't reliably apply per-test
// overrides here — see _LOOP_LEDGER fire-v2.44). querySearch takes an injectable
// `search` seam, so the test passes a fake directly. reindexSite degrades the
// real rag calls via .catch and counts chunks, so it needs no injection.
import { querySearch, reindexSite, FLAG_KEY, type SemanticSearchFn } from '../service.js';
import type { Env } from '../../../../src/types/env.js';

const env = { RAG_INDEX: {} } as unknown as Env;

describe('site_semantic_search', () => {
  it('exports the correct FLAG_KEY', () => {
    expect(FLAG_KEY).toBe('site_semantic_search');
  });

  it('querySearch() returns results from the search seam', async () => {
    const search = (async () => [
      { id: 'r1', text: 'Result text', score: 0.9 },
    ]) as unknown as SemanticSearchFn;
    const results = await querySearch(env, 'site-abc', 'test query', 5, search);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('r1');
    expect(results[0]!.text).toBe('Result text');
  });

  it('querySearch() returns empty array on RAG error', async () => {
    const search = (async () => {
      throw new Error('RAG down');
    }) as unknown as SemanticSearchFn;
    const results = await querySearch(env, 'site-abc', 'test', 5, search);
    expect(results).toEqual([]);
  });

  it('reindexSite() indexes chunks and returns count', async () => {
    const count = await reindexSite(env, 'site-abc', {
      chunks: [
        { id: 'c1', text: 'chunk one' },
        { id: 'c2', text: 'chunk two' },
      ],
    });
    expect(count).toBe(2);
  });
});
