/**
 * @module services/rag_publish
 * @description Shared helper for indexing published site files into Vectorize.
 *
 * Called from two places:
 *   - POST /api/publish/bolt (via waitUntil — non-blocking)
 *   - site-generation workflow on completion (via waitUntil)
 *
 * Guard: if `env.AI` or `env.RAG_INDEX` are absent the helper silently returns
 * (binding may be missing in local dev or test environments that don't configure
 * the Vectorize index).
 *
 * Text extraction strategy:
 *   - HTML files → strip tags, collapse whitespace, cap at 4 000 chars
 *   - Text files (.txt, .md) → use as-is, cap at 4 000 chars
 *   - All other file types (CSS, JS, images, fonts …) → skipped
 *
 * @see services/rag.ts — indexChunk, semanticSearch
 * @see routes/api.ts:2756 — /api/publish/bolt caller
 * @see workflows/site-generation.ts — workflow caller
 */

import type { Env } from '../types/env.js';
import { indexChunk } from './rag.js';

/** File extensions considered indexable page content. */
const INDEXABLE_EXTENSIONS = new Set(['html', 'htm', 'txt', 'md']);

/**
 * Strip HTML tags from a string and normalise whitespace.
 * Output is capped at 4 000 characters to stay within Vectorize metadata limits
 * and to keep embedding costs predictable.
 *
 * @param content - Raw file content (HTML or plain text).
 * @returns Plain text, ≤4 000 chars.
 *
 * @example
 * stripHtmlToText('<h1>Hello</h1><p>World</p>') // → 'Hello World'
 */
export function stripHtmlToText(content: string): string {
  // Remove HTML tags
  let text = content.replace(/<[^>]*>/g, ' ');
  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  // Cap length
  return text.slice(0, 4000);
}

/**
 * Determine if a file path should be indexed based on its extension.
 *
 * @param path - File path (e.g. 'index.html', 'style.css').
 * @returns true if the file extension is in the indexable set.
 */
function isIndexable(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return INDEXABLE_EXTENSIONS.has(ext);
}

/**
 * Resolve the owning org id for a bolt-published site so its indexed chunks are
 * discoverable via the org-scoped `/api/sites/:id/search` endpoint
 * (`semanticSearch` filters on `metadata.orgId`).
 *
 * Resolution order:
 *   1. Authenticated session org (`c.get('orgId')`) when present and not the
 *      `'bolt'` placeholder.
 *   2. The site row's `org_id` looked up by slug (covers anonymous publishes to
 *      an EXISTING owned slug — e.g. the owner's editor re-publishing).
 *   3. `'bolt'` fallback (a brand-new slug with no owner row yet).
 *
 * @param env - Worker bindings (needs `DB`).
 * @param slug - The published site slug.
 * @param sessionOrgId - `c.get('orgId')` from the request context, if any.
 * @returns The resolved org id; never empty.
 *
 * @example
 * await resolvePublishOrgId(env, 'acme-bakery', 'org_123') // → 'org_123'
 * await resolvePublishOrgId(env, 'acme-bakery', undefined)  // → site row org_id, else 'bolt'
 */
export async function resolvePublishOrgId(
  env: Env,
  slug: string,
  sessionOrgId?: string,
): Promise<string> {
  if (sessionOrgId && sessionOrgId !== 'bolt') return sessionOrgId;
  const owner = await env.DB.prepare(
    'SELECT org_id FROM sites WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
  )
    .bind(slug)
    .first<{ org_id: string }>()
    .catch(() => null);
  return owner?.org_id ?? 'bolt';
}

export interface IndexSiteFilesOptions {
  /** The site ID — stored as `sourceId` on each vector chunk. */
  siteId: string;
  /** Org ID passed through as metadata for later filtering. */
  orgId: string;
  /** Files from the publish payload. Each must have `path` and `content`. */
  files: Array<{ path: string; content: string }>;
}

/**
 * Non-blocking site-file indexer. Registers a waitUntil Promise that indexes
 * each page-content file (HTML/text) into Vectorize via `indexChunk`.
 *
 * @remarks Impure — calls Workers AI + Vectorize bindings inside waitUntil.
 *
 * Caller passes `executionCtx` so the response is never blocked. The indexing
 * runs concurrently with the response being sent.
 *
 * @param env - Worker bindings. Must have `AI` + `RAG_INDEX` for indexing to fire.
 * @param executionCtx - Cloudflare execution context (`c.executionCtx` in Hono).
 * @param opts - Site ID, org ID and file list.
 *
 * @example
 * // In a Hono route handler:
 * indexSiteFiles(c.env, c.executionCtx, { siteId, orgId, files });
 * return c.json({ data: { slug, url } }, 201);
 */
export function indexSiteFiles(
  env: Env,
  executionCtx: { waitUntil(p: Promise<unknown>): void },
  opts: IndexSiteFilesOptions,
): void {
  // Guard: skip silently when bindings are absent (local dev / unit tests / free plan)
  if (!env.AI || !env.RAG_INDEX) return;

  const { siteId, orgId, files } = opts;

  const indexWork = (async () => {
    for (const file of files) {
      if (!isIndexable(file.path)) continue;

      const text = stripHtmlToText(file.content);
      if (!text || text.length < 10) continue; // skip near-empty files

      const chunkId = `${siteId}::${file.path}`;

      await indexChunk(env, {
        id: chunkId,
        kind: 'site_page',
        sourceId: siteId,
        text,
        metadata: {
          orgId,
          path: file.path,
        },
      }).catch((err: unknown) => {
        // Non-fatal — log but don't break the publish
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'rag_publish: indexChunk failed',
            chunkId,
            siteId,
            error: String(err),
          }),
        );
      });
    }
  })();

  executionCtx.waitUntil(indexWork);
}
