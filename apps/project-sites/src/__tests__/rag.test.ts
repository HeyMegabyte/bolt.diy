/**
 * @module __tests__/rag
 * @description Smoke test for the Vectorize + AutoRAG layer in services/rag.ts.
 *
 * Mocks the Workers AI embedding call, the Vectorize binding, and the D1
 * `prepare().bind().run()` chain. Exercises `indexChunk` then `semanticSearch`
 * and asserts the embedding dimension + the shape of the returned matches.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbExecute } from '../services/db.js';
import { indexChunk, semanticSearch } from '../services/rag.js';

const EMBED_DIM = 768;

function makeEnv() {
  const embedding = Array(EMBED_DIM).fill(0.1) as number[];

  const aiRun = jest.fn().mockResolvedValue({ data: [embedding], shape: [1, EMBED_DIM] });

  const upsert = jest.fn().mockResolvedValue({ count: 1 });
  const query = jest.fn().mockResolvedValue({
    matches: [
      {
        id: 'chunk-1',
        score: 0.91,
        metadata: {
          kind: 'research',
          sourceId: 'site-abc',
          orgId: 'org-1',
          text: 'A short snippet about the business.',
        },
      },
      {
        id: 'chunk-2',
        score: 0.82,
        metadata: { kind: 'voice', sourceId: 'call-xyz', text: 'Caller asked about pricing.' },
      },
    ],
  });

  const run = jest.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
  const bind = jest.fn(() => ({ run, all: jest.fn().mockResolvedValue({ results: [], success: true }) }));
  const prepare = jest.fn(() => ({ bind }));

  const env = {
    AI: { run: aiRun } as unknown,
    DB: { prepare } as unknown,
    RAG_INDEX: { upsert, query, deleteByIds: jest.fn() },
  } as unknown as Parameters<typeof indexChunk>[0];

  return { env, aiRun, upsert, query, prepare, bind, run };
}

beforeEach(() => jest.clearAllMocks());

describe('services/rag', () => {
  it('indexChunk embeds via Workers AI, upserts into Vectorize, and mirrors to D1', async () => {
    const { env, aiRun, upsert } = makeEnv();

    const result = await indexChunk(env, {
      id: 'chunk-1',
      kind: 'research',
      sourceId: 'site-abc',
      text: 'A short snippet about the business.',
      metadata: { orgId: 'org-1', confidence: 0.9 },
    });

    expect(result.id).toBe('chunk-1');
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);

    const upsertArg = upsert.mock.calls[0][0] as Array<{ id: string; values: number[]; metadata: Record<string, unknown> }>;
    expect(upsertArg).toHaveLength(1);
    expect(upsertArg[0].id).toBe('chunk-1');
    expect(upsertArg[0].values).toHaveLength(EMBED_DIM);
    expect(upsertArg[0].metadata.kind).toBe('research');
    expect(upsertArg[0].metadata.sourceId).toBe('site-abc');
    expect(upsertArg[0].metadata.orgId).toBe('org-1');
    expect(typeof upsertArg[0].metadata.text).toBe('string');

    expect(dbExecute).toHaveBeenCalledTimes(1);
  });

  it('semanticSearch returns shaped match results with kind, sourceId, text, score', async () => {
    const { env, query } = makeEnv();

    const results = await semanticSearch(env, 'pricing questions from callers', {
      topK: 5,
      kinds: ['voice', 'research'],
      orgId: 'org-1',
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [vector, options] = query.mock.calls[0];
    expect(Array.isArray(vector)).toBe(true);
    expect(vector).toHaveLength(EMBED_DIM);
    expect(options.topK).toBe(5);
    expect(options.filter.orgId).toBe('org-1');
    expect(options.filter.kind).toEqual({ $in: ['voice', 'research'] });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(
      expect.objectContaining({
        score: 0.91,
        kind: 'research',
        sourceId: 'site-abc',
        text: 'A short snippet about the business.',
      }),
    );
    expect(results[1].kind).toBe('voice');
    expect(typeof results[1].metadata).toBe('object');
  });
});
