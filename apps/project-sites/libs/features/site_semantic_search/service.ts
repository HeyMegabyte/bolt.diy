import type { Env } from '../../../src/types/env.js';
import { semanticSearch, indexChunk, deleteIndex } from '../../../src/services/rag.js';
import type { SiteSearchResult, SiteReindexRequest } from './schemas.js';

export const FLAG_KEY = 'site_semantic_search';

export async function querySearch(
  env: Env,
  siteId: string,
  query: string,
  topK: number,
): Promise<SiteSearchResult[]> {
  const chunks = await semanticSearch(env, query, { topK, orgId: siteId }).catch(() => []);
  return chunks.map((c: { id?: string; text?: string; content?: string; score?: number }) => ({
    id: c.id ?? '',
    text: c.text ?? c.content ?? '',
    score: c.score,
  }));
}

export async function reindexSite(
  env: Env,
  siteId: string,
  body: SiteReindexRequest,
): Promise<number> {
  await deleteIndex(env, 'site_content', siteId).catch(() => null);
  let count = 0;
  for (const chunk of body.chunks) {
    await indexChunk(env, {
      kind: 'site_content',
      sourceId: siteId,
      id: chunk.id,
      text: chunk.text,
      metadata: chunk.metadata ?? {},
    }).catch(() => null);
    count++;
  }
  return count;
}
