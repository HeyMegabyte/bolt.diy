/**
 * @module editor-native/services/editor-chat
 *
 * @description
 * State container for the native editor chat. Holds the active chat,
 * its message list, and the streaming-in-progress flag as signals.
 * Orchestrates the round-trip:
 *
 *   1. `sendMessage(text)` — persist user message to D1, push optimistic
 *      assistant placeholder, open SSE stream
 *   2. Accumulate `delta` events into the placeholder
 *   3. On `done`, persist the final assistant text to D1
 *   4. On `error`, mark the placeholder as failed + surface a toast
 *
 * Designed to be provided at component level (one instance per active
 * chat surface) so multiple editors don't share state.
 *
 * @example
 * ```ts
 * const chat = inject(EditorChatService);
 * await chat.createChat(siteId);
 * chat.sendMessage('Add a hero section');
 * ```
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { ToastService } from '../../services/toast.service';
import {
  EditorLlmService,
  type LlmMessage,
  type LlmProvider,
} from './editor-llm.service';

export interface EditorChat {
  id: string;
  site_id: string;
  user_id: string;
  title: string;
  model: string;
  provider: LlmProvider;
  created_at: string;
  updated_at: string;
}

export interface EditorMessage {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tokens_in?: number | null;
  tokens_out?: number | null;
  cost_usd?: number | null;
  created_at: string;
  /** True while the message is being streamed in. Local-only flag. */
  streaming?: boolean;
  /** True when the stream errored mid-flight. */
  failed?: boolean;
}

@Injectable()
export class EditorChatService {
  private api = inject(ApiService);
  private llm = inject(EditorLlmService);
  private toast = inject(ToastService);

  readonly chats = signal<EditorChat[]>([]);
  readonly currentChat = signal<EditorChat | null>(null);
  readonly messages = signal<EditorMessage[]>([]);
  readonly streaming = signal(false);
  readonly loading = signal(false);

  /** Convenience: provider currently driving the active chat. */
  readonly provider = computed<LlmProvider>(() => this.currentChat()?.provider ?? 'workers-ai');

  private activeStream: Subscription | null = null;

  /** List every chat for a site so the sidebar can render it. */
  loadChatsForSite(siteId: string): Promise<EditorChat[]> {
    return new Promise((resolve) => {
      this.api
        .get<{ chats: EditorChat[] }>(`/editor-chats?site_id=${encodeURIComponent(siteId)}`)
        .subscribe({
          next: (res) => {
            this.chats.set(res.chats ?? []);
            resolve(res.chats ?? []);
          },
          error: () => resolve([]),
        });
    });
  }

  /** Load chat + messages by id. Caches the result in `messages`. */
  loadChat(chatId: string): Promise<void> {
    this.loading.set(true);
    return new Promise((resolve) => {
      this.api
        .get<{ chat: EditorChat; messages: EditorMessage[] }>(
          `/editor-chats/${encodeURIComponent(chatId)}`,
        )
        .subscribe({
          next: (res) => {
            this.currentChat.set(res.chat);
            this.messages.set(res.messages ?? []);
            this.loading.set(false);
            resolve();
          },
          error: () => {
            this.loading.set(false);
            resolve();
          },
        });
    });
  }

  /** Create + activate a new chat against the given site. */
  createChat(siteId: string, provider: LlmProvider = 'workers-ai'): Promise<EditorChat | null> {
    return new Promise((resolve) => {
      this.api
        .post<{ chat: EditorChat }>('/editor-chats', { site_id: siteId, provider })
        .subscribe({
          next: (res) => {
            this.currentChat.set(res.chat);
            this.messages.set([]);
            this.chats.update((list) => [res.chat, ...list]);
            resolve(res.chat);
          },
          error: () => resolve(null),
        });
    });
  }

  /** Soft-delete a chat. */
  deleteChat(chatId: string): Promise<void> {
    return new Promise((resolve) => {
      this.api.delete<{ ok: boolean }>(`/editor-chats/${encodeURIComponent(chatId)}`).subscribe({
        next: () => {
          this.chats.update((list) => list.filter((c) => c.id !== chatId));
          if (this.currentChat()?.id === chatId) {
            this.currentChat.set(null);
            this.messages.set([]);
          }
          resolve();
        },
        error: () => resolve(),
      });
    });
  }

  /** Switch the active chat's provider (e.g., dropdown change). */
  setProvider(provider: LlmProvider): void {
    const chat = this.currentChat();
    if (!chat) return;
    this.currentChat.set({ ...chat, provider });
  }

  /** Switch the active model. */
  setModel(model: string): void {
    const chat = this.currentChat();
    if (!chat) return;
    this.currentChat.set({ ...chat, model });
  }

  /** Cancel any in-flight stream. */
  cancelStream(): void {
    this.activeStream?.unsubscribe();
    this.activeStream = null;
    this.streaming.set(false);
    this.messages.update((list) =>
      list.map((m) => (m.streaming ? { ...m, streaming: false, failed: true } : m)),
    );
  }

  /**
   * Persist a user message, push an optimistic assistant placeholder,
   * and open the SSE stream. Accumulates deltas into the placeholder
   * and persists the final assistant text on `done`.
   */
  async sendMessage(content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) return;
    const chat = this.currentChat();
    if (!chat) {
      this.toast.error('No active chat — create one first.');
      return;
    }
    if (this.streaming()) {
      this.toast.warning('Wait for the current response, or hit Cancel.');
      return;
    }

    // 1) Persist user message.
    const userMsg = await this.persistMessage(chat.id, 'user', trimmed);
    if (!userMsg) return;
    this.messages.update((list) => [...list, userMsg]);

    // 2) Push optimistic assistant placeholder.
    const placeholderId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const placeholder: EditorMessage = {
      id: placeholderId,
      chat_id: chat.id,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      streaming: true,
    };
    this.messages.update((list) => [...list, placeholder]);

    // 3) Open the SSE stream.
    this.streaming.set(true);
    const llmMessages: LlmMessage[] = this.messages()
      .filter((m) => !m.streaming && !m.failed)
      .map((m) => ({ role: m.role, content: m.content }));

    let acc = '';
    let tokenStats: { in?: number; out?: number } = {};

    this.activeStream = this.llm
      .streamChat({
        chatId: chat.id,
        provider: chat.provider,
        model: chat.model,
        messages: llmMessages,
      })
      .subscribe({
        next: (event) => {
          if (event.delta) {
            acc += event.delta;
            this.messages.update((list) =>
              list.map((m) => (m.id === placeholderId ? { ...m, content: acc } : m)),
            );
          }
          if (event.tokens) {
            tokenStats = { ...tokenStats, ...event.tokens };
          }
          if (event.error) {
            this.streaming.set(false);
            this.messages.update((list) =>
              list.map((m) =>
                m.id === placeholderId
                  ? { ...m, streaming: false, failed: true, content: this.errorMessage(event.error!) }
                  : m,
              ),
            );
            this.toast.error(this.errorMessage(event.error));
          }
          if (event.done) {
            this.streaming.set(false);
            this.finalizeAssistantMessage(chat.id, placeholderId, acc, tokenStats);
          }
        },
        error: () => {
          this.streaming.set(false);
          this.messages.update((list) =>
            list.map((m) =>
              m.id === placeholderId
                ? { ...m, streaming: false, failed: true, content: 'Stream failed unexpectedly.' }
                : m,
            ),
          );
        },
      });
  }

  // ─── helpers ────────────────────────────────────────────────

  private async persistMessage(
    chatId: string,
    role: EditorMessage['role'],
    content: string,
    tokens?: { in?: number; out?: number },
  ): Promise<EditorMessage | null> {
    return new Promise((resolve) => {
      this.api
        .post<{ message: EditorMessage }>(
          `/editor-chats/${encodeURIComponent(chatId)}/messages`,
          {
            role,
            content,
            tokens_in: tokens?.in,
            tokens_out: tokens?.out,
          },
        )
        .subscribe({
          next: (res) => resolve(res.message ?? null),
          error: () => resolve(null),
        });
    });
  }

  private finalizeAssistantMessage(
    chatId: string,
    placeholderId: string,
    content: string,
    tokens: { in?: number; out?: number },
  ): void {
    if (!content) {
      this.messages.update((list) =>
        list.map((m) =>
          m.id === placeholderId
            ? { ...m, streaming: false, failed: true, content: 'Empty response.' }
            : m,
        ),
      );
      return;
    }
    void this.persistMessage(chatId, 'assistant', content, tokens).then((saved) => {
      if (!saved) {
        // Keep the optimistic copy on screen even if persist failed.
        this.messages.update((list) =>
          list.map((m) =>
            m.id === placeholderId ? { ...m, streaming: false, tokens_in: tokens.in, tokens_out: tokens.out } : m,
          ),
        );
        return;
      }
      this.messages.update((list) =>
        list.map((m) => (m.id === placeholderId ? { ...saved, streaming: false } : m)),
      );
    });
  }

  private errorMessage(code: string): string {
    if (code === 'openai_api_key_missing')
      return 'Add your OpenAI key in Settings → AI providers to use this provider.';
    if (code === 'anthropic_api_key_missing')
      return 'Add your Anthropic key in Settings → AI providers to use this provider.';
    if (code === 'ollama_unreachable')
      return 'Ollama is not reachable. Start it with `ollama serve` on http://localhost:11434.';
    if (code.startsWith('openai_error') || code.startsWith('anthropic_error')) {
      return `LLM provider rejected the request (${code}).`;
    }
    return `Stream failed: ${code}`;
  }
}
