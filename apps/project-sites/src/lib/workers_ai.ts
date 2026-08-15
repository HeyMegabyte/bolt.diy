/**
 * @module lib/workers_ai
 * @description One observed seam for direct Cloudflare Workers AI (`env.AI.run`)
 * calls. Wrapping a call in {@link runObservedWorkersAI} fires the same
 * {@link captureLLMCall} hook the upstream (DeepSeek/OpenAI/Anthropic) path uses —
 * so a "simple task on free CF AI" now shows up in PostHog `$ai_generation` AND
 * Langfuse with model, token usage, latency, and cost, instead of being an
 * unobserved black hole (Brian iter 57: "simple tasks with Ollama free on CF …
 * integrates langfuse / token monitoring / prices").
 *
 * @remarks Workers AI is included on the Workers Paid plan, so `costUsd` is `0`.
 * Modern Llama models return a `usage` block; when absent we estimate tokens at
 * ~4 chars/token (the same heuristic `ai_workflows.ts` already uses). Observability
 * is fail-soft: it never throws and never suppresses the AI call's own error.
 */
import type { Env } from '../types/env.js';
import { captureLLMCall } from '../services/analytics.js';

/** Correlation metadata for one observed Workers AI call. */
export interface WorkersAiObsMeta {
  /** PostHog/Langfuse distinct id — org id, user id, or anon id. */
  distinctId: string;
  /** Logical prompt/task name (e.g. `ai_categorize`) — becomes the Langfuse trace name. */
  promptId?: string;
  /** Trace id to roll multi-step flows together. */
  traceId?: string;
}

interface WorkersAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

/** Pull the assistant text out of a Workers AI result for token estimation. */
function extractText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'response' in result) {
    const r = (result as { response?: unknown }).response;
    return typeof r === 'string' ? r : '';
  }
  return '';
}

/** ~4 chars per token — the same heuristic used across the codebase for Workers AI. */
function estimateTokens(text: string): number {
  return Math.max(0, Math.ceil(text.length / 4));
}

/**
 * Run a Workers AI model and observe it (PostHog + Langfuse) exactly like the
 * upstream LLM path. Returns the raw `env.AI.run` result unchanged.
 *
 * @param env - Worker env (needs the `AI` binding).
 * @param model - Workers AI model id (e.g. `@cf/meta/llama-3.1-8b-instruct-fp8`).
 * @param inputs - The model inputs (messages, prompt, max_tokens, …).
 * @param meta - Correlation metadata (distinctId required).
 * @returns The raw model result.
 * @throws Re-throws whatever `env.AI.run` throws (observability is recorded first).
 * @example
 * const result = await runObservedWorkersAI(
 *   c.env,
 *   '@cf/meta/llama-3.1-8b-instruct-fp8',
 *   { messages: [{ role: 'user', content: prompt }], max_tokens: 30 },
 *   { distinctId: orgId, promptId: 'ai_categorize', traceId: requestId },
 * );
 */
export async function runObservedWorkersAI(
  env: Env,
  model: string,
  inputs: Record<string, unknown>,
  meta: WorkersAiObsMeta,
): Promise<unknown> {
  const startedAt = Date.now();
  const promptText = JSON.stringify(inputs ?? {});

  try {
    const result = await (
      env.AI as unknown as { run: (m: string, i: unknown) => Promise<unknown> }
    ).run(model, inputs);
    const usage =
      result && typeof result === 'object'
        ? (result as { usage?: WorkersAiUsage }).usage
        : undefined;
    await safeCapture(env, {
      distinctId: meta.distinctId,
      provider: 'workers_ai',
      model,
      promptId: meta.promptId,
      inputTokens: usage?.prompt_tokens ?? estimateTokens(promptText),
      outputTokens: usage?.completion_tokens ?? estimateTokens(extractText(result)),
      latencyMs: Date.now() - startedAt,
      costUsd: 0, // Workers AI is included on Workers Paid.
      status: 'ok',
      traceId: meta.traceId,
    });
    return result;
  } catch (err) {
    await safeCapture(env, {
      distinctId: meta.distinctId,
      provider: 'workers_ai',
      model,
      promptId: meta.promptId,
      inputTokens: estimateTokens(promptText),
      outputTokens: 0,
      latencyMs: Date.now() - startedAt,
      costUsd: 0,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      traceId: meta.traceId,
    });
    throw err;
  }
}

/** captureLLMCall wrapped so observability failures never touch the AI call path. */
async function safeCapture(env: Env, params: Parameters<typeof captureLLMCall>[1]): Promise<void> {
  try {
    await captureLLMCall(env, params);
  } catch {
    // fail-soft: PostHog/Langfuse must never break or block a Workers AI call.
  }
}
