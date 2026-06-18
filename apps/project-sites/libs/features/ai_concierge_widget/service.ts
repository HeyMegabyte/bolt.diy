import type { Env } from '../../../src/types/env.js';
import { semanticSearch } from '../../../src/services/rag.js';
import type { ConciergeMessageResponse } from './schemas.js';

export const FLAG_KEY = 'ai_concierge_widget';
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** Injectable RAG-search seam — defaults to the real Vectorize-backed search. */
export type SemanticSearchFn = typeof semanticSearch;

export async function answer(
  env: Env,
  siteId: string,
  message: string,
  search: SemanticSearchFn = semanticSearch,
): Promise<ConciergeMessageResponse> {
  const chunks = await search(env, message, { topK: 5, orgId: siteId }).catch(() => []);
  const context = chunks
    .map((c: { text?: string; content?: string }) => c.text ?? c.content ?? '')
    .filter(Boolean)
    .join('\n\n');
  const systemPrompt = context
    ? `You are a helpful assistant for this website. Answer using only the context below.\n\nContext:\n${context}`
    : 'You are a helpful assistant for this website. Answer concisely.';

  let reply = 'I could not find an answer. Please contact us directly.';
  try {
    const result = await (
      env.AI as {
        run: (
          model: string,
          params: { messages: { role: string; content: string }[] },
        ) => Promise<{ response?: string }>;
      }
    ).run(MODEL, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
    });
    if (result?.response) reply = result.response;
  } catch {
    // fallback reply already set
  }

  return { reply, groundedOn: chunks.map((c: { id?: string }) => c.id ?? '').filter(Boolean) };
}

export async function getConfig(
  siteId: string,
): Promise<{ siteId: string; enabled: boolean; greeting: string }> {
  return { siteId, enabled: true, greeting: 'Hi! How can I help you today?' };
}
