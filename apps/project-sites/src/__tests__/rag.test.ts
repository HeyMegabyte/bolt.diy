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

import { dbExecute, dbQuery } from '../services/db.js';
import { indexChunk, semanticSearch, deleteIndex } from '../services/rag.js';

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
  const bind = jest.fn(() => ({
    run,
    all: jest.fn().mockResolvedValue({ results: [], success: true }),
  }));
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

    const upsertArg = upsert.mock.calls[0][0] as Array<{
      id: string;
      values: number[];
      metadata: Record<string, unknown>;
    }>;
    expect(upsertArg).toHaveLength(1);
    expect(upsertArg[0].id).toBe('chunk-1');
    expect(upsertArg[0].values).toHaveLength(EMBED_DIM);
    expect(upsertArg[0].metadata.kind).toBe('research');
    expect(upsertArg[0].metadata.sourceId).toBe('site-abc');
    expect(upsertArg[0].metadata.orgId).toBe('org-1');
    expect(typeof upsertArg[0].metadata.text).toBe('string');

    expect(dbExecute).toHaveBeenCalledTimes(1);
  });

  it('indexChunk SURFACES a D1 mirror write failure (Vectorize↔D1 divergence) but stays fail-soft', async () => {
    // The Vectorize upsert succeeds first; if the authoritative D1 mirror write
    // then fails, the chunk is searchable but can't be found/deleted by
    // (kind, sourceId) → an orphaned vector. The old code swallowed the dbExecute
    // {error} silently. Now it must LOG the divergence (never a silent drop) while
    // still resolving (the primary index write succeeded; re-index is idempotent).
    const { env, upsert } = makeEnv();
    (dbExecute as jest.Mock).mockResolvedValueOnce({ error: 'D1_ERROR: disk full', changes: 0 });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await indexChunk(env, {
      id: 'chunk-x',
      kind: 'research',
      sourceId: 'site-x',
      text: 'hello world text for embedding',
    });

    expect(result.id).toBe('chunk-x'); // fail-soft: still resolves
    expect(upsert).toHaveBeenCalledTimes(1); // primary Vectorize write happened
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      service: 'rag',
      message: 'index_chunk_mirror_write_failed',
      chunk_id: 'chunk-x',
    });
    warnSpy.mockRestore();
  });

  it('deleteIndex SURFACES a D1 mirror DELETE failure instead of silently claiming success', async () => {
    // Old bug: the DELETE swallowed its {error} and `return { removed: ids.length }`
    // reported success even when the D1 rows were NOT deleted (lying-success).
    const { env } = makeEnv();
    (dbQuery as jest.Mock).mockResolvedValueOnce({
      data: [{ id: 'chunk-1' }, { id: 'chunk-2' }],
      error: null,
    });
    (dbExecute as jest.Mock).mockResolvedValueOnce({ error: 'D1_ERROR: locked', changes: 0 });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await deleteIndex(env, 'research', 'site-x');

    expect(res.removed).toBe(2); // reflects the Vectorize vectors targeted/removed
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      service: 'rag',
      message: 'delete_index_mirror_delete_failed',
      kind: 'research',
    });
    warnSpy.mockRestore();
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

  it('clamps topK to Vectorize’s 20-max (returnMetadata:"all" 400s above 20)', async () => {
    const { env, query } = makeEnv();

    // A caller asking for 50 must NOT reach Vectorize with topK:50 — that is a
    // hard 400 because the query sets returnMetadata:'all'. Degrade to 20.
    await semanticSearch(env, 'big result set', { topK: 50, orgId: 'org-1' });

    const [, options] = query.mock.calls[0];
    expect(options.topK).toBe(20);
    expect(options.returnMetadata).toBe('all');
  });

  it('clamps a zero/negative topK up to 1 (Vectorize requires topK >= 1)', async () => {
    const { env, query } = makeEnv();

    await semanticSearch(env, 'edge', { topK: 0 });

    const [, options] = query.mock.calls[0];
    expect(options.topK).toBe(1);
  });
});
