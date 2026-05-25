/**
 * @module rag
 * @description Cloudflare Vectorize + AutoRAG layer for semantic search across
 * research, voice transcripts, audit logs, forms, and AI traces.
 *
 * Embeds text via Workers AI (`@cf/baai/bge-base-en-v1.5`, 768 dim), upserts
 * vectors into a Vectorize index with per-chunk metadata (kind, sourceId,
 * orgId, text preview), and queries with optional `kinds[]` / `orgId` filters.
 * Mirrors each chunk into D1 `rag_chunks` so re-index operations have a stable
 * authoritative source.
 *
 * When the optional `AUTORAG` binding is present, `autoRagQuery()` delegates
 * to Cloudflare's managed AutoRAG knowledge-base flow. Otherwise it falls
 * back to a semantic-search + Workers-AI synthesis loop that returns the same
 * `{response, data}` shape with inline citations.
 *
 * @packageDocumentation
 */

import type { Env as BaseEnv } from '../types/env.js';
import { dbExecute, dbQuery } from './db.js';

/**
 * Per-vector metadata stored alongside the 768-dim embedding in Vectorize.
 *
 * Vectorize metadata filters are exact-match only — keep keys lowercase
 * strings or numbers. `text` is truncated to 500 chars so we never blow past
 * the 10 KiB per-vector metadata cap when paired with other fields.
 */
export interface RagMetadata {
  kind: string;
  sourceId: string;
  orgId?: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * One match returned by {@link semanticSearch}.
 */
export interface RagSearchResult {
  score: number;
  kind: string;
  sourceId: string;
  text: string;
  metadata: Record<string, unknown>;
}

/** Minimal Vectorize binding shape — avoids dependency on `@cloudflare/workers-types` Vectorize typings drift. */
interface VectorizeBinding {
  upsert(vectors: Array<{ id: string; values: number[]; metadata?: Record<string, unknown> }>): Promise<unknown>;
  query(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
      returnMetadata?: 'all' | 'indexed' | boolean;
      returnValues?: boolean;
    },
  ): Promise<{ matches?: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

/** Minimal AutoRAG binding shape (Cloudflare AI Search). */
interface AutoRagBinding {
  aiSearch(args: { query: string; max_num_results?: number; filters?: Record<string, unknown> }): Promise<unknown>;
}

/** Local env intersection — augments the worker `Env` with the optional RAG bindings without editing `types/env.ts`. */
type Env = BaseEnv & {
  RAG_INDEX?: VectorizeBinding;
  AUTORAG?: AutoRagBinding;
};

const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBEDDING_DIM = 768;
const SYNTHESIS_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * Embed an arbitrary string into a 768-dim vector via Workers AI.
 *
 * @throws if the model returns no data or the wrong dimension.
 */
export async function embedText(env: Env, text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('embedText: empty input');
  const result = (await env.AI.run(EMBEDDING_MODEL as unknown as Parameters<typeof env.AI.run>[0], {
    text: trimmed,
  } as never)) as { data?: number[][]; shape?: number[] };
  const vector = result?.data?.[0];
  if (!vector || !Array.isArray(vector) || vector.length !== EMBEDDING_DIM) {
    throw new Error(`embedText: invalid embedding (got ${vector?.length ?? 0}, expected ${EMBEDDING_DIM})`);
  }
  return vector;
}

/**
 * Embed + upsert a chunk into both Vectorize and the D1 mirror.
 *
 * Requires `env.RAG_INDEX` to be bound. The D1 row is REPLACE'd so re-indexing
 * the same `id` is safe.
 */
export async function indexChunk(
  env: Env,
  args: { id: string; kind: string; sourceId: string; text: string; metadata?: Record<string, unknown> },
): Promise<{ id: string }> {
  if (!env.RAG_INDEX) throw new Error('indexChunk: RAG_INDEX binding missing');
  const { id, kind, sourceId, text } = args;
  const extra = args.metadata ?? {};
  const orgId = typeof extra.orgId === 'string' ? extra.orgId : undefined;

  const values = await embedText(env, text);
  const metadata: RagMetadata = {
    kind,
    sourceId,
    ...(orgId ? { orgId } : {}),
    text: text.slice(0, 500),
    ...extra,
  };

  await env.RAG_INDEX.upsert([{ id, values, metadata: metadata as Record<string, unknown> }]);

  await dbExecute(
    env.DB,
    `INSERT INTO rag_chunks (id, kind, source_id, org_id, text, metadata_json, embedded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       source_id = excluded.source_id,
       org_id = excluded.org_id,
       text = excluded.text,
       metadata_json = excluded.metadata_json,
       embedded_at = excluded.embedded_at`,
    [id, kind, sourceId, orgId ?? null, text, JSON.stringify(extra), Date.now()],
  );

  return { id };
}

/**
 * Embed the query and return the top-K nearest vectors.
 *
 * Optional `kinds[]` and `orgId` translate into Vectorize metadata filters.
 * The `$in` operator scopes a kind list; `orgId` is exact-match.
 */
export async function semanticSearch(
  env: Env,
  query: string,
  opts: { topK?: number; kinds?: string[]; orgId?: string } = {},
): Promise<RagSearchResult[]> {
  if (!env.RAG_INDEX) throw new Error('semanticSearch: RAG_INDEX binding missing');
  const topK = opts.topK ?? 10;
  const vector = await embedText(env, query);

  const filter: Record<string, unknown> = {};
  if (opts.kinds && opts.kinds.length > 0) filter.kind = { $in: opts.kinds };
  if (opts.orgId) filter.orgId = opts.orgId;

  const res = await env.RAG_INDEX.query(vector, {
    topK,
    returnMetadata: 'all',
    ...(Object.keys(filter).length > 0 ? { filter } : {}),
  });

  const matches = res?.matches ?? [];
  return matches.map((m) => {
    const md = (m.metadata ?? {}) as Record<string, unknown>;
    return {
      score: m.score,
      kind: typeof md.kind === 'string' ? md.kind : 'unknown',
      sourceId: typeof md.sourceId === 'string' ? md.sourceId : m.id,
      text: typeof md.text === 'string' ? md.text : '',
      metadata: md,
    };
  });
}

/**
 * AutoRAG-style answer synthesis with citations.
 *
 * Prefers the managed `env.AUTORAG.aiSearch` flow when available; falls back
 * to a semantic-search + Workers-AI Llama synthesis loop that returns a
 * compatible `{response, data}` shape.
 */
export async function autoRagQuery(
  env: Env,
  question: string,
  opts: { topK?: number; orgId?: string; kinds?: string[] } = {},
): Promise<{ response: string; data: Array<RagSearchResult> }> {
  const topK = opts.topK ?? 5;

  if (env.AUTORAG) {
    const filters: Record<string, unknown> = {};
    if (opts.orgId) filters.orgId = opts.orgId;
    if (opts.kinds && opts.kinds.length > 0) filters.kind = { $in: opts.kinds };
    const native = (await env.AUTORAG.aiSearch({
      query: question,
      max_num_results: topK,
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
    })) as { response?: string; data?: Array<RagSearchResult> };
    return {
      response: typeof native?.response === 'string' ? native.response : '',
      data: Array.isArray(native?.data) ? native.data : [],
    };
  }

  const matches = await semanticSearch(env, question, { topK, orgId: opts.orgId, kinds: opts.kinds });
  if (matches.length === 0) {
    return { response: 'No matching context found.', data: [] };
  }

  const context = matches
    .map((m, i) => `[${i + 1}] (${m.kind}/${m.sourceId}) ${m.text}`)
    .join('\n\n');

  const prompt = [
    'Answer the user question using ONLY the provided context.',
    'Cite sources inline as [1], [2], etc. matching the context blocks.',
    'If the context does not contain the answer, say so plainly.',
    '',
    `CONTEXT:\n${context}`,
    '',
    `QUESTION: ${question}`,
  ].join('\n');

  const completion = (await env.AI.run(SYNTHESIS_MODEL as unknown as Parameters<typeof env.AI.run>[0], {
    messages: [
      { role: 'system', content: 'You are a precise retrieval-augmented assistant. Cite every claim.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 600,
  } as never)) as { response?: string };

  return {
    response: typeof completion?.response === 'string' ? completion.response : '',
    data: matches,
  };
}

/**
 * Remove a chunk from both Vectorize and the D1 mirror by `(kind, sourceId)`.
 */
export async function deleteIndex(env: Env, kind: string, sourceId: string): Promise<{ removed: number }> {
  const { data } = await dbQuery<{ id: string }>(
    env.DB,
    `SELECT id FROM rag_chunks WHERE kind = ? AND source_id = ?`,
    [kind, sourceId],
  );
  const ids = data.map((r) => r.id);
  if (ids.length === 0) return { removed: 0 };

  if (env.RAG_INDEX) {
    try {
      await env.RAG_INDEX.deleteByIds(ids);
    } catch {
      // best-effort — D1 mirror still cleared below so re-index is safe
    }
  }

  await dbExecute(env.DB, `DELETE FROM rag_chunks WHERE kind = ? AND source_id = ?`, [kind, sourceId]);
  return { removed: ids.length };
}
