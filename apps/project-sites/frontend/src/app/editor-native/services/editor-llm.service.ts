/**
 * @module editor-native/services/editor-llm
 *
 * @description
 * Frontend wrapper around the worker's `POST /api/editor-chats/:chatId/stream`
 * SSE endpoint. Exposes a single `streamChat()` method returning an
 * `Observable<StreamEvent>` that emits one event per chunk:
 *
 *   - `{ delta: '…token…' }`     — assistant text fragment
 *   - `{ tokens: { in, out } }`  — running token usage
 *   - `{ done: true }`           — stream ended cleanly
 *   - `{ error: 'reason' }`      — provider/network failure
 *
 * Provider API keys NEVER reach the browser — every call goes through
 * the worker's authenticated proxy.
 *
 * Provider list (4 — Workers AI + OpenAI + Anthropic + Ollama):
 *
 * | Provider     | Default model                                   |
 * | ------------ | ----------------------------------------------- |
 * | workers-ai   | `@cf/meta/llama-3.3-70b-instruct-fp8-fast`     |
 * | openai       | `gpt-4o-mini`                                  |
 * | anthropic    | `claude-sonnet-4-6`                            |
 * | ollama       | `llama3.1` (localhost:11434)                   |
 *
 * @example
 * ```ts
 * const llm = inject(EditorLlmService);
 * llm.streamChat({ chatId, provider: 'anthropic', messages }).subscribe(ev => {
 *   if (ev.delta) console.warn('delta', ev.delta);
 *   if (ev.done) console.warn('done');
 * });
 * ```
 */

import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { AuthService } from '../../services/auth.service';

export type LlmProvider = 'workers-ai' | 'openai' | 'anthropic' | 'ollama';

export type LlmRole = 'user' | 'assistant' | 'system' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface StreamRequest {
  chatId: string;
  provider: LlmProvider;
  model?: string;
  messages: LlmMessage[];
}

export interface StreamEvent {
  delta?: string;
  tokens?: { in?: number; out?: number };
  done?: boolean;
  error?: string;
}

export const PROVIDER_PRESETS: Record<
  LlmProvider,
  { label: string; models: string[]; needsRemoteKey: boolean }
> = {
  'workers-ai': {
    label: 'Workers AI (Llama 3.3 70B)',
    models: [
      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
    ],
    needsRemoteKey: false,
  },
  openai: {
    label: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
    needsRemoteKey: true,
  },
  anthropic: {
    label: 'Anthropic Claude',
    models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'],
    needsRemoteKey: true,
  },
  ollama: {
    label: 'Ollama (local)',
    models: ['llama3.1', 'llama3.2', 'qwen2.5-coder', 'codellama'],
    needsRemoteKey: false,
  },
};

@Injectable({ providedIn: 'root' })
export class EditorLlmService {
  private auth = inject(AuthService);

  /**
   * Stream a chat completion via the worker proxy. Emits one `StreamEvent`
   * per chunk; the Observable completes on `done` or `error`.
   *
   * The returned Observable is cold — each subscription opens a fresh
   * `fetch`. Use `share()` or store the result in a signal if multiple
   * consumers need the same stream.
   */
  streamChat(req: StreamRequest): Observable<StreamEvent> {
    return new Observable<StreamEvent>((subscriber) => {
      const controller = new AbortController();

      const run = async (): Promise<void> => {
        const token = this.auth.getToken();
        if (!token) {
          subscriber.next({ error: 'unauthenticated' });
          subscriber.complete();
          return;
        }

        let res: Response;
        try {
          res = await fetch(`/api/editor-chats/${encodeURIComponent(req.chatId)}/stream`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              Accept: 'text/event-stream',
            },
            body: JSON.stringify({
              messages: req.messages,
              provider: req.provider,
              model: req.model,
            }),
            signal: controller.signal,
          });
        } catch (err) {
          subscriber.next({ error: err instanceof Error ? err.message : 'network_error' });
          subscriber.complete();
          return;
        }

        if (!res.ok || !res.body) {
          subscriber.next({ error: `http_${res.status}` });
          subscriber.complete();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx = buffer.indexOf('\n\n');
            while (idx !== -1) {
              const event = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              for (const line of event.split('\n')) {
                const trimmed = line.trimStart();
                if (!trimmed.startsWith('data:')) continue;
                const data = trimmed.slice(5).trimStart();
                if (!data) continue;
                try {
                  const parsed = JSON.parse(data) as StreamEvent;
                  subscriber.next(parsed);
                  if (parsed.done || parsed.error) {
                    subscriber.complete();
                    return;
                  }
                } catch {
                  // Drop malformed envelope; keep streaming.
                }
              }
              idx = buffer.indexOf('\n\n');
            }
          }
          subscriber.complete();
        } catch (err) {
          if ((err as { name?: string })?.name !== 'AbortError') {
            subscriber.next({ error: err instanceof Error ? err.message : 'stream_failed' });
          }
          subscriber.complete();
        }
      };

      void run();

      return () => controller.abort();
    });
  }
}
