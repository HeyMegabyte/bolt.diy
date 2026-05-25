/**
 * Auto-suggest next 3 prompts based on recent chat history.
 * Server-side Llama 3.1 8B call cached in KV via the admin worker.
 *
 * @remarks
 *   Calls the absolute `https://projectsites.dev/api/bolt/...` URL rather
 *   than a relative path. Two reasons:
 *
 *   1. The iframe runs on `editor.projectsites.dev`, where the Cloudflare
 *      zone WAF blocks every POST request (Pages-app rule). The Worker
 *      that hosts these handlers lives on the `projectsites.dev` zone,
 *      so we must hit it directly.
 *   2. The legacy `/admin-api/...` prefix is blocked by a path-pattern
 *      WAF rule (`admin*`). The new `/api/bolt/...` prefix avoids it.
 *
 *   CORS is configured in `apps/project-sites/src/index.ts` to allow
 *   `https://editor.projectsites.dev`. The bolt soft-auth path accepts
 *   the iframe Origin in lieu of a session bearer token.
 */

import type { Message } from 'ai';

const ENDPOINT = 'https://projectsites.dev/api/bolt/chat/suggest-prompts';

export interface PromptSuggestion {
  label: string;
  prompt: string;
}

export async function fetchPromptSuggestions(
  messages: Message[],
  token?: string,
): Promise<PromptSuggestion[]> {
  if (!messages.length) {
    return [];
  }

  const tail = messages.slice(-6).map((m) => ({
    role: m.role,
    content: (typeof m.content === 'string' ? m.content : '').slice(0, 800),
  }));

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ tail, max: 3 }),
    });

    if (!res.ok) {
      console.warn('suggest-prompts non-2xx', res.status);
      return [];
    }

    const data = (await res.json()) as { suggestions?: PromptSuggestion[] };

    return Array.isArray(data.suggestions) ? data.suggestions.slice(0, 3) : [];
  } catch (err) {
    console.warn('suggest-prompts failed', err);
    return [];
  }
}
