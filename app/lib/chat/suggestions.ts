/**
 * Auto-suggest next 3 prompts based on recent chat history.
 * Server-side Llama 3.1 8B call cached in KV via the admin worker.
 */

import type { Message } from 'ai';

const ENDPOINT = '/admin-api/chat/suggest-prompts';

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
