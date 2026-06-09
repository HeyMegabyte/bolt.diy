/**
 * ai_concierge_widget — "Ask my site" RAG concierge.
 *
 * `POST /api/sites/:id/concierge { q }` answers a visitor question grounded in
 * the site's own indexed content via the existing RAG pipeline (Vectorize +
 * Workers AI synthesis in `services/rag.ts`), returning `{ answer, sources }`.
 * Flag-gated by `ai_concierge_widget` (404 when off); Zod-validated; never
 * fabricates — when RAG/AI bindings are absent it returns a calm provisioning
 * note instead of a guess.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { isFlagOn } from '../modules/feature_flags/services.js';
import { autoRagQuery } from '../services/rag.js';

const ConciergeBody = z.object({ q: z.string().trim().min(2).max(500) });

export interface ConciergeSource {
  title: string;
  kind: string;
  score: number;
}

/**
 * Map RAG matches to a deduped, ranked source list for the widget. Pure +
 * deterministic (exported for unit tests). Prefers a metadata title/url, then
 * the source id, then the kind; rounds the score to 2dp; caps at 5.
 */
export function formatSources(
  data: ReadonlyArray<{ kind?: string; score?: number; sourceId?: string; metadata?: Record<string, unknown> }>,
): ConciergeSource[] {
  const seen = new Set<string>();
  const out: ConciergeSource[] = [];
  for (const d of data ?? []) {
    const title = String(d.metadata?.['title'] ?? d.metadata?.['url'] ?? d.sourceId ?? d.kind ?? 'Result');
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title, kind: d.kind ?? 'unknown', score: Math.round((d.score ?? 0) * 100) / 100 });
  }
  return out.slice(0, 5);
}

export const concierge = new Hono<{ Bindings: Env; Variables: Variables }>();

concierge.post('/api/sites/:id/concierge', async (c) => {
  const siteId = c.req.param('id');
  const on = await isFlagOn(c.env, 'ai_concierge_widget', { siteId, orgId: c.get('orgId'), userId: c.get('userId') });
  if (!on) return c.notFound();

  const parsed = ConciergeBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Ask a question (2-500 characters).' } }, 400);
  }

  if (!c.env.AI) {
    return c.json({ answer: null, sources: [], notes: 'The AI concierge is still provisioning for this site.' }, 200);
  }

  try {
    const { response, data } = await autoRagQuery(c.env, parsed.data.q, { orgId: c.get('orgId'), topK: 5 });
    return c.json({ answer: response, sources: formatSources(data) });
  } catch {
    return c.json({ answer: null, sources: [], notes: 'Couldn’t answer that right now — please try again.' }, 200);
  }
});
