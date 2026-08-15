/**
 * @module lib/langfuse
 * @description Thin, dependency-free Langfuse ingestion client for Cloudflare
 * Workers. Tees every LLM call (from {@link services/analytics.captureLLMCall})
 * into Langfuse as a trace + generation so token counts, cost, model, provider,
 * and tier show up in the Langfuse dashboard alongside the AI Gateway logs and the
 * PostHog `$ai_generation` signal. No SDK — a single `fetch` to the public
 * ingestion API (`POST /api/public/ingestion`, HTTP Basic auth).
 *
 * @remarks Impure — one network call. Fully guarded: a no-op (never throws, never
 * blocks the caller) when the `LANGFUSE_*` secrets are unset or on any error;
 * observability must never break an LLM call.
 */
import type { Env } from '../types/env.js';

/** The LLM-call shape teed from `captureLLMCall` (a superset-compatible subset). */
export interface LangfuseLlmCall {
  distinctId: string;
  provider: string;
  model: string;
  promptId?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  costUsd?: number;
  status: string;
  errorMessage?: string;
  traceId?: string;
  cacheHit?: boolean;
  gatewayUsed?: boolean;
}

/**
 * True when all three Langfuse secrets are present, i.e. ingestion is possible.
 *
 * @param env - Worker env.
 * @returns Whether Langfuse is configured.
 * @example if (isLangfuseConfigured(env)) { … }
 */
export function isLangfuseConfigured(env: Env): boolean {
  return !!(env.LANGFUSE_BASE_URL && env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

/**
 * Send one LLM generation (as a trace + generation) to Langfuse. Fire-and-forget.
 *
 * @param env - Worker env (reads `LANGFUSE_BASE_URL` / `_PUBLIC_KEY` / `_SECRET_KEY`).
 * @param call - The same params object {@link captureLLMCall} receives.
 * @returns Resolves once the ingestion request settles (or immediately when unconfigured).
 * @example
 * void captureLangfuseGeneration(env, {
 *   distinctId: orgId, provider: 'deepseek', model: 'deepseek-chat',
 *   inputTokens: 800, outputTokens: 400, latencyMs: 1200, costUsd: 0.0004, status: 'ok',
 * });
 */
export async function captureLangfuseGeneration(env: Env, call: LangfuseLlmCall): Promise<void> {
  const base = env.LANGFUSE_BASE_URL;
  const pub = env.LANGFUSE_PUBLIC_KEY;
  const secret = env.LANGFUSE_SECRET_KEY;
  if (!base || !pub || !secret) return; // no-op when unconfigured

  try {
    const endMs = Date.now();
    const startMs = endMs - Math.max(0, call.latencyMs || 0);
    const input = call.inputTokens ?? 0;
    const output = call.outputTokens ?? 0;
    const traceId = call.traceId || crypto.randomUUID();
    const name = call.promptId || `${call.provider}:${call.model}`;
    const endIso = new Date(endMs).toISOString();

    const payload = {
      batch: [
        {
          id: crypto.randomUUID(),
          type: 'trace-create',
          timestamp: endIso,
          body: {
            id: traceId,
            name,
            userId: call.distinctId,
            metadata: { provider: call.provider, promptId: call.promptId ?? null },
          },
        },
        {
          id: crypto.randomUUID(),
          type: 'generation-create',
          timestamp: endIso,
          body: {
            id: crypto.randomUUID(),
            traceId,
            name,
            model: call.model,
            startTime: new Date(startMs).toISOString(),
            endTime: endIso,
            level: call.status === 'ok' ? 'DEFAULT' : 'ERROR',
            statusMessage: call.errorMessage ?? null,
            usage: {
              input,
              output,
              total: input + output,
              unit: 'TOKENS',
              totalCost: call.costUsd ?? 0,
            },
            metadata: {
              provider: call.provider,
              status: call.status,
              latencyMs: call.latencyMs,
              cacheHit: call.cacheHit ?? false,
              gatewayUsed: call.gatewayUsed ?? false,
            },
          },
        },
      ],
    };

    await fetch(`${base.replace(/\/$/, '')}/api/public/ingestion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${pub}:${secret}`)}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // fail-soft: Langfuse observability must never break or slow an LLM call.
  }
}
