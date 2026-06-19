/**
 * Self-hosted inference adapter (Coolify GPU box behind a Cloudflare Tunnel).
 *
 * @remarks
 * The home server (2× RTX 2080 Ti) serves an **OpenAI-compatible** vLLM endpoint
 * + a ComfyUI image endpoint. Per `projectsites-cloudflare-first` it is an
 * EXTERNAL ORIGIN escape hatch — isolated behind THIS adapter, env-gated, and
 * NEVER in the public hot path (residential uplink ⇒ batch/async/build-time work
 * only). Both resolvers return `null` when unconfigured so callers fall back to
 * the paid provider — zero behavior change until the env vars are set.
 *
 * Wiring (follow-up slice — ripples the provider union, so done in its own pass):
 *  - `external_llm` adds a `selfhosted` provider whose baseUrl/model come from
 *    {@link resolveSelfHostedLlm}; falls back to DeepSeek/OpenAI on 5xx.
 *  - `image_generation` tries {@link resolveSelfHostedImage} first, DALL·E next.
 *
 * @packageDocumentation
 */
import type { Env } from '../types/env.js';

/** Resolved self-hosted OpenAI-compatible LLM endpoint config. */
export interface SelfHostedLlm {
  /** Base URL WITHOUT a trailing slash, e.g. `https://llm.projectsites.dev`. */
  baseUrl: string;
  /** Chat-completions path appended to baseUrl. */
  chatPath: string;
  /** Default model id served by the box (vLLM `--served-model-name`). */
  model: string;
  /** Optional bearer token (vLLM `--api-key`); empty string when none. */
  apiKey: string;
}

/** Resolved self-hosted ComfyUI image endpoint config. */
export interface SelfHostedImage {
  /** Base URL WITHOUT a trailing slash. */
  baseUrl: string;
  /** Default checkpoint / workflow id (e.g. `sdxl` or a saved ComfyUI workflow). */
  model: string;
  /** Optional bearer token; empty string when none. */
  apiKey: string;
}

/** Strip a trailing slash so path-join never double-slashes. */
function trimUrl(u: string): string {
  return u.trim().replace(/\/+$/, '');
}

/** True only for a well-formed http(s) URL. */
function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Resolve the self-hosted vLLM endpoint, or `null` when unconfigured/invalid.
 * Gated on `SELFHOST_LLM_URL`. Pure + total — never throws.
 *
 * @param env - Worker env (reads `SELFHOST_LLM_URL`, `SELFHOST_LLM_MODEL`,
 *   `SELFHOST_LLM_API_KEY`).
 * @returns A {@link SelfHostedLlm}, or `null` to signal "fall back to a paid provider".
 * @example
 * const sh = resolveSelfHostedLlm(env);
 * if (sh) await fetch(sh.baseUrl + sh.chatPath, { headers: { Authorization: `Bearer ${sh.apiKey}` } });
 */
export function resolveSelfHostedLlm(env: Env): SelfHostedLlm | null {
  const raw = (env as { SELFHOST_LLM_URL?: string }).SELFHOST_LLM_URL;
  if (!raw || !isHttpUrl(raw)) return null;
  const model = (env as { SELFHOST_LLM_MODEL?: string }).SELFHOST_LLM_MODEL?.trim();
  const apiKey = (env as { SELFHOST_LLM_API_KEY?: string }).SELFHOST_LLM_API_KEY?.trim();
  return {
    baseUrl: trimUrl(raw),
    chatPath: '/v1/chat/completions',
    model: model && model.length > 0 ? model : 'qwen2.5-32b-instruct',
    apiKey: apiKey ?? '',
  };
}

/**
 * Resolve the self-hosted ComfyUI image endpoint, or `null` when unconfigured.
 * Gated on `SELFHOST_IMAGE_URL`. Pure + total — never throws.
 *
 * @param env - Worker env (reads `SELFHOST_IMAGE_URL`, `SELFHOST_IMAGE_MODEL`,
 *   `SELFHOST_IMAGE_API_KEY`).
 * @returns A {@link SelfHostedImage}, or `null` to signal "fall back to DALL·E".
 */
export function resolveSelfHostedImage(env: Env): SelfHostedImage | null {
  const raw = (env as { SELFHOST_IMAGE_URL?: string }).SELFHOST_IMAGE_URL;
  if (!raw || !isHttpUrl(raw)) return null;
  const model = (env as { SELFHOST_IMAGE_MODEL?: string }).SELFHOST_IMAGE_MODEL?.trim();
  const apiKey = (env as { SELFHOST_IMAGE_API_KEY?: string }).SELFHOST_IMAGE_API_KEY?.trim();
  return {
    baseUrl: trimUrl(raw),
    model: model && model.length > 0 ? model : 'sdxl',
    apiKey: apiKey ?? '',
  };
}

/** True when EITHER self-hosted backend is configured (for capability flags / UI). */
export function hasSelfHostedInference(env: Env): boolean {
  return resolveSelfHostedLlm(env) !== null || resolveSelfHostedImage(env) !== null;
}
