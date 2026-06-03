/**
 * Unit coverage for services/editor_llm.ts (convergence r17).
 *
 * `streamChatResponse` fans out across 4 providers (workers-ai, openai,
 * anthropic, ollama) and normalises every delta + token-usage signal via
 * the `onDelta` / `onTokens` callbacks. This suite covers:
 *   - provider routing + the unknown-provider throw
 *   - per-provider request build (URL, headers, body shape, default model)
 *   - SSE success parse (delta + token capture), partial-chunk buffering
 *   - Anthropic system-message hoist + tool→user role remap
 *   - Ollama NDJSON parse + early-return on `done`
 *   - missing-key handling (openai/anthropic)
 *   - non-200 + network-throw + malformed-chunk + empty-input edge cases
 *
 * The SUT has NO module-level state (no circuit breaker), so a single
 * top-level import is safe. All network is mocked via `global.fetch` and a
 * fake `env.AI.run` — no real APIs are ever hit.
 */

import type { Env } from '../types/env.js';
import {
  streamChatResponse,
  type ChatMessage,
  type LlmProvider,
  type StreamArgs,
} from '../services/editor_llm.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a ReadableStream<Uint8Array> from raw text chunks (as written). */
function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

/** An SSE-shaped Response (status 200, has a body stream). */
function sseResponse(chunks: string[], status = 200): Response {
  const body = status === 200 ? streamFrom(chunks) : null;
  return new Response(body as unknown as BodyInit | null, { status });
}

interface Collected {
  deltas: string[];
  tokens: Array<{ in?: number; out?: number }>;
}

function collector(): { c: Collected; onDelta: StreamArgs['onDelta']; onTokens: StreamArgs['onTokens'] } {
  const c: Collected = { deltas: [], tokens: [] };
  return {
    c,
    onDelta: (t) => c.deltas.push(t),
    onTokens: (t) => c.tokens.push(t),
  };
}

function makeArgs(
  provider: LlmProvider,
  overrides?: Partial<StreamArgs>,
  col = collector(),
): { args: StreamArgs; c: Collected } {
  const messages: ChatMessage[] = overrides?.messages ?? [
    { role: 'user', content: 'hello' },
  ];
  return {
    c: col.c,
    args: {
      provider,
      model: '',
      messages,
      onDelta: col.onDelta,
      onTokens: col.onTokens,
      ...overrides,
    },
  };
}

function makeEnv(overrides?: Partial<Env>, aiRun?: jest.Mock): Env {
  return {
    OPENAI_API_KEY: 'sk-openai-test',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    AI: { run: aiRun ?? jest.fn() },
    ...overrides,
  } as unknown as Env;
}

let fetchSpy: jest.Mock;
const realFetch = global.fetch;

beforeEach(() => {
  fetchSpy = jest.fn();
  global.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

// ── Routing ───────────────────────────────────────────────────────────────

describe('streamChatResponse — provider routing', () => {
  it('throws on an unknown provider', async () => {
    const { args } = makeArgs('mystery' as unknown as LlmProvider);
    await expect(streamChatResponse(makeEnv(), args)).rejects.toThrow('unknown_provider:mystery');
  });

  it('routes workers-ai to env.AI.run (not global fetch)', async () => {
    const aiRun = jest.fn(async () => streamFrom(['data: {"response":"hi"}\n\n']));
    const env = makeEnv({}, aiRun);
    const { args } = makeArgs('workers-ai');
    await streamChatResponse(env, args);
    expect(aiRun).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('routes openai/anthropic through global fetch', async () => {
    fetchSpy.mockImplementation(async () => sseResponse([])); // fresh body per call
    for (const p of ['openai', 'anthropic'] as LlmProvider[]) {
      const { args } = makeArgs(p);
      await streamChatResponse(makeEnv(), args);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

// ── Workers AI ──────────────────────────────────────────────────────────────

describe('streamChatResponse — workers-ai', () => {
  it('uses the default fp8-fast model when none supplied', async () => {
    const aiRun = jest.fn(async () => streamFrom(['data: {"response":"x"}\n\n']));
    const { args } = makeArgs('workers-ai');
    await streamChatResponse(makeEnv({}, aiRun), args);
    expect(aiRun.mock.calls[0]![0]).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
    const body = aiRun.mock.calls[0]![1] as { stream: boolean; max_tokens: number; messages: unknown[] };
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(4096);
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('honours an explicit model override', async () => {
    const aiRun = jest.fn(async () => streamFrom([]));
    const { args } = makeArgs('workers-ai', { model: '@cf/custom/model' });
    await streamChatResponse(makeEnv({}, aiRun), args);
    expect(aiRun.mock.calls[0]![0]).toBe('@cf/custom/model');
  });

  it('emits deltas for both `response` and `p` envelope keys, ignores [DONE] + non-JSON', async () => {
    const aiRun = jest.fn(async () =>
      streamFrom([
        'data: {"response":"Hello"}\n\n',
        'data: {"p":" world"}\n\n',
        'data: not-json\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const { args, c } = makeArgs('workers-ai');
    await streamChatResponse(makeEnv({}, aiRun), args);
    expect(c.deltas).toEqual(['Hello', ' world']);
  });

  it('skips empty deltas', async () => {
    const aiRun = jest.fn(async () => streamFrom(['data: {"response":""}\n\n']));
    const { args, c } = makeArgs('workers-ai');
    await streamChatResponse(makeEnv({}, aiRun), args);
    expect(c.deltas).toEqual([]);
  });
});

// ── OpenAI ────────────────────────────────────────────────────────────────

describe('streamChatResponse — openai', () => {
  it('throws when OPENAI_API_KEY is missing', async () => {
    const { args } = makeArgs('openai');
    await expect(streamChatResponse(makeEnv({ OPENAI_API_KEY: undefined }), args)).rejects.toThrow(
      'openai_api_key_missing',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('builds the request: URL, bearer auth, default model, stream + usage opts', async () => {
    fetchSpy.mockResolvedValue(sseResponse([]));
    const { args } = makeArgs('openai');
    await streamChatResponse(makeEnv(), args);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-openai-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('honours an explicit model', async () => {
    fetchSpy.mockResolvedValue(sseResponse([]));
    const { args } = makeArgs('openai', { model: 'gpt-4o' });
    await streamChatResponse(makeEnv(), args);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body as string).model).toBe('gpt-4o');
  });

  it('parses content deltas + usage, ignoring [DONE] + malformed chunks', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
        'data: {"choices":[{"delta":{}}]}\n\n',
        'data: {oops\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":4}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const { args, c } = makeArgs('openai');
    await streamChatResponse(makeEnv(), args);
    expect(c.deltas).toEqual(['Hi']);
    expect(c.tokens).toEqual([{ in: 11, out: 4 }]);
  });

  it('throws a coded error on non-200 (and reads the body)', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 429 }));
    const { args } = makeArgs('openai');
    await expect(streamChatResponse(makeEnv(), args)).rejects.toThrow(/^openai_error:429:rate limited/);
  });

  it('throws when the response has no body', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    const { args } = makeArgs('openai');
    await expect(streamChatResponse(makeEnv(), args)).rejects.toThrow(/^openai_error:200/);
  });
});

// ── Anthropic ───────────────────────────────────────────────────────────────

describe('streamChatResponse — anthropic', () => {
  it('throws when ANTHROPIC_API_KEY is missing', async () => {
    const { args } = makeArgs('anthropic');
    await expect(streamChatResponse(makeEnv({ ANTHROPIC_API_KEY: undefined }), args)).rejects.toThrow(
      'anthropic_api_key_missing',
    );
  });

  it('hoists the system message, remaps tool→user, sets default model + headers', async () => {
    fetchSpy.mockResolvedValue(sseResponse([]));
    const messages: ChatMessage[] = [
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'q' },
      { role: 'tool', content: 'tool-output' },
    ];
    const { args } = makeArgs('anthropic', { messages });
    await streamChatResponse(makeEnv(), args);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-sonnet-4-6');
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([
      { role: 'user', content: 'q' },
      { role: 'user', content: 'tool-output' }, // tool remapped to user
    ]);
  });

  it('leaves system undefined when no system message exists', async () => {
    fetchSpy.mockResolvedValue(sseResponse([]));
    const { args } = makeArgs('anthropic', { messages: [{ role: 'user', content: 'hi' }] });
    await streamChatResponse(makeEnv(), args);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body as string).system).toBeUndefined();
  });

  it('captures content_block_delta text + usage (top-level and message.usage)', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"He"}}\n\n',
        'data: {"type":"content_block_delta","delta":{"text":"llo"}}\n\n',
        'data: {"type":"content_block_delta","delta":{}}\n\n',
        'data: {"type":"message_delta","usage":{"output_tokens":9}}\n\n',
      ]),
    );
    const { args, c } = makeArgs('anthropic');
    await streamChatResponse(makeEnv(), args);
    expect(c.deltas).toEqual(['He', 'llo']);
    expect(c.tokens).toEqual([{ in: 7, out: undefined }, { in: undefined, out: 9 }]);
  });

  it('throws a coded error on non-200', async () => {
    fetchSpy.mockResolvedValue(new Response('overloaded', { status: 529 }));
    const { args } = makeArgs('anthropic');
    await expect(streamChatResponse(makeEnv(), args)).rejects.toThrow(/^anthropic_error:529:overloaded/);
  });

  it('ignores malformed chunks without throwing', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse(['data: {bad\n\n', 'data: {"type":"content_block_delta","delta":{"text":"ok"}}\n\n']),
    );
    const { args, c } = makeArgs('anthropic');
    await streamChatResponse(makeEnv(), args);
    expect(c.deltas).toEqual(['ok']);
  });
});

// ── Ollama ────────────────────────────────────────────────────────────────

describe('streamChatResponse — ollama', () => {
  it('hits localhost with the default model + NDJSON body', async () => {
    fetchSpy.mockResolvedValue(
      new Response(streamFrom(['{"message":{"content":"hi"},"done":false}\n', '{"done":true}\n']), { status: 200 }),
    );
    const { args } = makeArgs('ollama');
    await streamChatResponse(makeEnv(), args);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('llama3.1');
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('parses NDJSON deltas and emits tokens + returns on done', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        streamFrom([
          '{"message":{"content":"Hel"}}\n',
          '\n', // blank line skipped
          '{"message":{"content":"lo"}}\n',
          '{"done":true,"prompt_eval_count":5,"eval_count":12}\n',
          '{"message":{"content":"NEVER"}}\n', // after done — must not be read
        ]),
        { status: 200 },
      ),
    );
    const { args, c } = makeArgs('ollama');
    await streamChatResponse(makeEnv(), args);
    expect(c.deltas).toEqual(['Hel', 'lo']);
    expect(c.tokens).toEqual([{ in: 5, out: 12 }]);
  });

  it('skips malformed NDJSON lines', async () => {
    fetchSpy.mockResolvedValue(
      new Response(streamFrom(['{bad json\n', '{"message":{"content":"ok"}}\n']), { status: 200 }),
    );
    const { args, c } = makeArgs('ollama');
    await streamChatResponse(makeEnv(), args);
    expect(c.deltas).toEqual(['ok']);
  });

  it('throws ollama_unreachable when fetch rejects (production case)', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const { args } = makeArgs('ollama');
    await expect(streamChatResponse(makeEnv(), args)).rejects.toThrow('ollama_unreachable');
  });

  it('throws a coded error on non-200', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));
    const { args } = makeArgs('ollama');
    await expect(streamChatResponse(makeEnv(), args)).rejects.toThrow('ollama_error:500');
  });

  it('honours an explicit ollama model', async () => {
    fetchSpy.mockResolvedValue(new Response(streamFrom(['{"done":true}\n']), { status: 200 }));
    const { args } = makeArgs('ollama', { model: 'mistral' });
    await streamChatResponse(makeEnv(), args);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body as string).model).toBe('mistral');
  });
});

// ── SSE parser edge cases (exercised through openai) ──────────────────────────

describe('streamChatResponse — SSE parser buffering + edges', () => {
  it('reassembles a `data:` line split across read boundaries', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"split',
        '-content"}}]}\n\n',
      ]),
    );
    const { args, c } = makeArgs('openai');
    await streamChatResponse(makeEnv(), args);
    expect(c.deltas).toEqual(['split-content']);
  });

  it('handles an empty stream (no deltas, no tokens, no throw)', async () => {
    fetchSpy.mockResolvedValue(sseResponse([]));
    const { args, c } = makeArgs('openai');
    await streamChatResponse(makeEnv(), args);
    expect(c.deltas).toEqual([]);
    expect(c.tokens).toEqual([]);
  });

  it('handles an empty messages array (passes [] through to the provider)', async () => {
    fetchSpy.mockResolvedValue(sseResponse([]));
    const { args } = makeArgs('openai', { messages: [] });
    await streamChatResponse(makeEnv(), args);
    expect(JSON.parse(fetchSpy.mock.calls[0]![1].body as string).messages).toEqual([]);
  });

  it('parses multiple events arriving in a single chunk', async () => {
    fetchSpy.mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\n',
      ]),
    );
    const { args, c } = makeArgs('openai');
    await streamChatResponse(makeEnv(), args);
    expect(c.deltas).toEqual(['a', 'b']);
  });
});
