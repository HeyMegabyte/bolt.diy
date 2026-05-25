/**
 * Mirrors local IDB chat state to admin worker (D1) every 30s.
 *
 * @remarks
 *   IDB stays the primary source of truth; D1 is a write-only mirror used
 *   for cross-device sync and remote diagnostics. Failures are logged via
 *   console.warn and never block the user.
 */

import type { Message } from 'ai';

const SYNC_INTERVAL_MS = 30_000;
// Absolute URL targeting the projectsites.dev worker. The iframe runs on
// editor.projectsites.dev where the zone WAF blocks every POST; we must
// hit the API on the projectsites.dev zone instead. The `/api/bolt/`
// prefix avoids the legacy `/admin-api/` WAF block. See
// `apps/project-sites/src/routes/bolt_admin.ts` JSDoc for the full
// auth + path-migration contract.
const ENDPOINT_BASE = 'https://projectsites.dev/api/bolt/sites/by-slug';

let timer: ReturnType<typeof setInterval> | null = null;
let lastHash = '';

function hashMessages(messages: Message[]): string {
  if (!messages.length) {
    return '0';
  }

  return `${messages.length}:${messages[messages.length - 1].id ?? ''}:${(messages[messages.length - 1].content ?? '').length}`;
}

async function pushOnce(slug: string, chatId: string, messages: Message[], token?: string): Promise<void> {
  const hash = hashMessages(messages);

  if (hash === lastHash) {
    return;
  }

  const url = `${ENDPOINT_BASE}/${encodeURIComponent(slug)}/chat-state`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_count: messages.length,
        last_message_id: messages[messages.length - 1]?.id,
        updated_at: new Date().toISOString(),
        // Truncated tail — never sync full body to avoid 4xx on large chats
        tail: messages.slice(-4).map((m) => ({
          id: m.id,
          role: m.role,
          excerpt: (typeof m.content === 'string' ? m.content : '').slice(0, 280),
        })),
      }),
      keepalive: true,
    });

    if (!res.ok) {
      console.warn('chat-state mirror non-2xx', res.status);
      return;
    }

    lastHash = hash;
  } catch (err) {
    console.warn('chat-state mirror failed', err);
  }
}

interface StartOpts {
  slug: string;
  chatId: string;
  getMessages: () => Message[];
  token?: string;
}

export function startChatStateMirror(opts: StartOpts): () => void {
  stopChatStateMirror();

  const tick = () => pushOnce(opts.slug, opts.chatId, opts.getMessages(), opts.token);

  timer = setInterval(tick, SYNC_INTERVAL_MS);

  // Fire on tab-hide and pagehide for last-chance delivery
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      tick();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    stopChatStateMirror();
  };
}

export function stopChatStateMirror(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
