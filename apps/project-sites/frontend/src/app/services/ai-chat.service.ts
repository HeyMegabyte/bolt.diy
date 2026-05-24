/**
 * @module services/ai-chat
 *
 * @description
 * Conversation store backing the floating `<app-ai-chat-widget>` and any
 * future surface that wants to drop into the assistant's history. Holds a
 * signal-first store of recent conversations (LRU-capped at 20), persists
 * every mutation to `sessionStorage['ps_ai_chat_v1']`, and exposes a
 * `computed()` `messages()` slice for the active conversation so consumers
 * can bind directly without re-deriving.
 *
 * Persistence is intentionally `sessionStorage` (not `localStorage`) so
 * conversations don't leak across browser tabs/users on shared machines;
 * the admin shell is single-tab by design and we'd rather drop history
 * than surprise the next operator with someone else's prompts.
 *
 * @remarks
 * - Storage key: `ps_ai_chat_v1` (versioned — bump on schema break).
 * - LRU cap: 20 conversations. Oldest evicted on overflow (by `updatedAt`).
 * - SSR-safe: every `sessionStorage` call is wrapped in try/catch.
 *
 * @example
 * ```ts
 * const chat = inject(AiChatService);
 * const id = chat.newConversation();
 * chat.addMessage('user', 'Summarize my admin');
 * chat.addMessage('assistant', 'You have 4 sites…');
 * const blob = chat.exportActive();
 * ```
 */

import { Injectable, computed, signal } from '@angular/core';

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  /** Stable per-message id (epoch-ms + random suffix). */
  id: string;
  role: ChatRole;
  content: string;
  /** Tool-call name when `role === 'tool'`, undefined otherwise. */
  toolName?: string;
  /** Epoch ms when the message was appended. */
  createdAt: number;
}

export interface Conversation {
  id: string;
  /** Short label shown in the switcher (first user message, truncated). */
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'ps_ai_chat_v1';
const LRU_CAP = 20;

interface PersistedState {
  conversations: Conversation[];
  activeId: string | null;
}

@Injectable({ providedIn: 'root' })
export class AiChatService {
  readonly conversations = signal<Conversation[]>([]);
  readonly activeId = signal<string | null>(null);

  readonly activeConversation = computed<Conversation | null>(() => {
    const id = this.activeId();
    if (!id) return null;
    return this.conversations().find((c) => c.id === id) ?? null;
  });

  readonly messages = computed<ChatMessage[]>(
    () => this.activeConversation()?.messages ?? [],
  );

  constructor() {
    this.load();
  }

  // ─────────── public surface ───────────

  /** Create a new empty conversation, activate it, return its id. */
  newConversation(): string {
    const id = this.makeId('conv');
    const now = Date.now();
    const conv: Conversation = {
      id,
      title: 'New conversation',
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.update((list) => this.enforceLru([conv, ...list]));
    this.activeId.set(id);
    this.persist();
    return id;
  }

  /** Switch the active conversation. Silent no-op if id unknown. */
  selectConversation(id: string): void {
    if (!this.conversations().some((c) => c.id === id)) return;
    this.activeId.set(id);
    this.persist();
  }

  /**
   * Append a message to the active conversation. Auto-creates a conversation
   * when none exists. Derives the title from the first user message.
   */
  addMessage(role: ChatRole, content: string, toolName?: string): void {
    if (!this.activeId()) this.newConversation();
    const id = this.activeId();
    if (!id) return;

    const msg: ChatMessage = {
      id: this.makeId('msg'),
      role,
      content,
      toolName,
      createdAt: Date.now(),
    };

    this.conversations.update((list) =>
      list.map((c) => {
        if (c.id !== id) return c;
        const nextMessages = [...c.messages, msg];
        const nextTitle =
          c.title === 'New conversation' && role === 'user'
            ? truncate(content, 48)
            : c.title;
        return {
          ...c,
          title: nextTitle,
          messages: nextMessages,
          updatedAt: Date.now(),
        };
      }),
    );
    this.persist();
  }

  /**
   * Replace the last message's content (used by SSE streaming to update an
   * in-flight assistant turn without re-rendering the entire list).
   */
  updateLastMessage(content: string): void {
    const id = this.activeId();
    if (!id) return;
    this.conversations.update((list) =>
      list.map((c) => {
        if (c.id !== id || c.messages.length === 0) return c;
        const next = c.messages.slice(0, -1);
        const last = c.messages[c.messages.length - 1];
        if (!last) return c;
        next.push({ ...last, content });
        return { ...c, messages: next, updatedAt: Date.now() };
      }),
    );
    this.persist();
  }

  /** Clear the active conversation's messages (keeps the shell). */
  clearActive(): void {
    const id = this.activeId();
    if (!id) return;
    this.conversations.update((list) =>
      list.map((c) =>
        c.id === id
          ? { ...c, messages: [], title: 'New conversation', updatedAt: Date.now() }
          : c,
      ),
    );
    this.persist();
  }

  /** Drop a conversation; if it was active, fall back to the next-most-recent. */
  deleteConversation(id: string): void {
    this.conversations.update((list) => list.filter((c) => c.id !== id));
    if (this.activeId() === id) {
      const next = this.conversations()[0]?.id ?? null;
      this.activeId.set(next);
    }
    this.persist();
  }

  /**
   * Export the active conversation as a Markdown blob suitable for
   * `URL.createObjectURL` + `<a download>`. Returns an empty blob when no
   * conversation is active — callers should check `activeConversation()` first.
   */
  exportActive(): Blob {
    const conv = this.activeConversation();
    if (!conv) return new Blob([''], { type: 'text/markdown' });

    const lines: string[] = [];
    lines.push(`# ${conv.title}`);
    lines.push('');
    lines.push(`> Exported ${new Date().toISOString()}`);
    lines.push('');
    for (const m of conv.messages) {
      const speaker =
        m.role === 'tool' ? `**tool · ${m.toolName ?? 'unknown'}**` : `**${m.role}**`;
      lines.push(speaker);
      lines.push('');
      lines.push(m.content);
      lines.push('');
    }
    return new Blob([lines.join('\n')], { type: 'text/markdown' });
  }

  // ─────────── internals ───────────

  private enforceLru(list: Conversation[]): Conversation[] {
    if (list.length <= LRU_CAP) return list;
    return [...list]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, LRU_CAP);
  }

  private load(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (Array.isArray(parsed.conversations)) {
        this.conversations.set(this.enforceLru(parsed.conversations));
      }
      if (typeof parsed.activeId === 'string' || parsed.activeId === null) {
        this.activeId.set(parsed.activeId ?? null);
      }
    } catch {
      /* corrupt payload — fall back to empty state. */
    }
  }

  private persist(): void {
    if (typeof sessionStorage === 'undefined') return;
    try {
      const state: PersistedState = {
        conversations: this.conversations(),
        activeId: this.activeId(),
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / private mode — drop silently. */
    }
  }

  private makeId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

function truncate(s: string, n: number): string {
  const trimmed = s.trim().replace(/\s+/g, ' ');
  return trimmed.length <= n ? trimmed : `${trimmed.slice(0, n - 1)}…`;
}
