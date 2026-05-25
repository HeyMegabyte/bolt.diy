/**
 * @module services/editor_llm
 *
 * @description
 * Server-side LLM streaming proxy used by the native Angular editor at
 * `/admin/editor-native`. Implements ONE function — `streamChatResponse`
 * — that fans out across 4 providers: Workers AI, OpenAI, Anthropic,
 * Ollama. Each provider's deltas are normalised to `onDelta(text)` so
 * the route handler can blindly forward to the SSE channel.
 *
 * ## Provider notes
 *
 * - **workers-ai** — uses the bound `env.AI` binding with model
 *   `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The bare-alias model
 *   has been retired; the `-fp8-fast` variant is the only stable
 *   replacement (see `~/.claude/RECS.md` shipped item).
 * - **openai** — uses `OPENAI_API_KEY` against `chat/completions` with
 *   `stream: true`. Default model `gpt-4o-mini`.
 * - **anthropic** — uses `ANTHROPIC_API_KEY` against `/v1/messages`
 *   with `stream: true`. Default model `claude-sonnet-4-6`.
 * - **ollama** — hits `localhost:11434/api/chat`. Reaches local-dev
 *   only; the worker calls fail in production with a clear error so
 *   the UI can show the "Configure Ollama" CTA.
 *
 * @packageDocumentation
 */

import type { Env } from '../types/env.js';

export type LlmProvider = 'workers-ai' | 'openai' | 'anthropic' | 'ollama';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface StreamArgs {
  provider: LlmProvider;
  model: string;
  messages: ChatMessage[];
  onDelta: (text: string) => void;
  onTokens: (tokens: { in?: number; out?: number }) => void;
}

const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * Stream a chat completion from the chosen provider, forwarding every
 * delta + token-usage signal via the supplied callbacks. Throws when
 * the provider rejects, the API key is missing, or the model returns
 * a malformed envelope.
 */
export async function streamChatResponse(env: Env, args: StreamArgs): Promise<void> {
  switch (args.provider) {
    case 'workers-ai':
      return streamWorkersAi(env, args);
    case 'openai':
      return streamOpenAi(env, args);
    case 'anthropic':
      return streamAnthropic(env, args);
    case 'ollama':
      return streamOllama(args);
    default:
      throw new Error(`unknown_provider:${args.provider as string}`);
  }
}

// ─── Workers AI ──────────────────────────────────────────────────────

async function streamWorkersAi(env: Env, args: StreamArgs): Promise<void> {
  const model = (args.model || DEFAULT_WORKERS_AI_MODEL) as Parameters<typeof env.AI.run>[0];
  // Workers AI returns a ReadableStream<Uint8Array> when `stream: true`.
  const response = (await env.AI.run(
    model,
    {
      messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      max_tokens: 4096,
    } as unknown as Parameters<typeof env.AI.run>[1],
  )) as unknown as ReadableStream<Uint8Array>;

  await parseSseStream(response, (data) => {
    // Workers AI emits `data: {"response":"...delta..."}` per chunk.
    if (data === '[DONE]') return;
    try {
      const parsed = JSON.parse(data) as { response?: string; p?: string };
      const delta = parsed.response ?? parsed.p ?? '';
      if (delta) args.onDelta(delta);
    } catch {
      // Non-JSON line — ignore.
    }
  });
}

// ─── OpenAI ──────────────────────────────────────────────────────────

async function streamOpenAi(env: Env, args: StreamArgs): Promise<void> {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new Error('openai_api_key_missing');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: args.model || 'gpt-4o-mini',
      messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`openai_error:${res.status}:${text.slice(0, 200)}`);
  }

  await parseSseStream(res.body, (data) => {
    if (data === '[DONE]') return;
    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const delta = parsed.choices?.[0]?.delta?.content ?? '';
      if (delta) args.onDelta(delta);
      if (parsed.usage) {
        args.onTokens({
          in: parsed.usage.prompt_tokens,
          out: parsed.usage.completion_tokens,
        });
      }
    } catch {
      // Skip malformed chunk.
    }
  });
}

// ─── Anthropic ───────────────────────────────────────────────────────

async function streamAnthropic(env: Env, args: StreamArgs): Promise<void> {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('anthropic_api_key_missing');

  // Anthropic requires `system` as a top-level field, not a message.
  const systemMsg = args.messages.find((m) => m.role === 'system')?.content;
  const userMessages = args.messages.filter((m) => m.role !== 'system');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: args.model || 'claude-sonnet-4-6',
      max_tokens: 4096,
      stream: true,
      system: systemMsg,
      messages: userMessages.map((m) => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: m.content,
      })),
    }),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`anthropic_error:${res.status}:${text.slice(0, 200)}`);
  }

  await parseSseStream(res.body, (data) => {
    try {
      const parsed = JSON.parse(data) as {
        type?: string;
        delta?: { text?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      };
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        args.onDelta(parsed.delta.text);
      }
      const usage = parsed.usage ?? parsed.message?.usage;
      if (usage) {
        args.onTokens({ in: usage.input_tokens, out: usage.output_tokens });
      }
    } catch {
      // Skip malformed chunk.
    }
  });
}

// ─── Ollama (localhost only) ────────────────────────────────────────

async function streamOllama(args: StreamArgs): Promise<void> {
  // Will fail in production with `fetch failed` — the UI surfaces the
  // "Configure Ollama" CTA based on this exact error.
  let res: Response;
  try {
    res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: args.model || 'llama3.1',
        stream: true,
        messages: args.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
  } catch {
    throw new Error('ollama_unreachable');
  }

  if (!res.ok || !res.body) {
    throw new Error(`ollama_error:${res.status}`);
  }

  // Ollama emits newline-delimited JSON (not SSE).
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as {
          message?: { content?: string };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
        };
        const delta = parsed.message?.content ?? '';
        if (delta) args.onDelta(delta);
        if (parsed.done) {
          args.onTokens({ in: parsed.prompt_eval_count, out: parsed.eval_count });
          return;
        }
      } catch {
        // Skip malformed chunk.
      }
    }
  }
}

// ─── SSE parser ──────────────────────────────────────────────────────

/**
 * Parse a `text/event-stream` ReadableStream, extracting `data:` lines
 * and invoking the callback once per event. Handles partial chunk
 * boundaries by buffering until a `\n\n` event terminator is seen.
 */
async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

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
        if (trimmed.startsWith('data:')) {
          onData(trimmed.slice(5).trimStart());
        }
      }
      idx = buffer.indexOf('\n\n');
    }
  }
}
