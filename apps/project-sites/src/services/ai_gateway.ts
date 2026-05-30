/**
 * @module services/ai_gateway
 * @description Cloudflare AI Gateway routing for external LLM providers.
 *
 * Wraps every OpenAI / Anthropic call so it flows through the account's AI
 * Gateway by default, giving us — for free, with zero per-call code — universal
 * response caching, rate-limiting, structured request logs, cost attribution,
 * and metadata-tagged traces. When the gateway 5xx's (or is unconfigured) the
 * helper falls back to the direct vendor URL so generation NEVER breaks.
 *
 * ## Why a dedicated module
 *
 * `external_llm.ts` historically inlined a bare `aiGatewayUrl()` +
 * `fetchWithGatewayFallback()` that only honored `AI_GATEWAY_ENABLED === "true"`
 * and injected no cache headers. This module is the contract-first, Zod-validated
 * replacement: gateway is the DEFAULT path (caching is infrastructure, always-on
 * with a safe fallback), and callers get cache-TTL injection, per-call skip-cache,
 * and metadata tagging out of the box.
 *
 * ## URL shape
 *
 * `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayName}/{provider}{pathSuffix}`
 *
 * - `accountId` — {@link Env.CF_ACCOUNT_ID}
 * - `gatewayName` — {@link Env.AI_GATEWAY_NAME} (default `"projectsites"`)
 * - `provider` — `"openai"` | `"anthropic"`
 * - `pathSuffix` — vendor path, e.g. `/v1/chat/completions`, `/v1/messages`
 *
 * ## Cache + metadata headers (AI Gateway native)
 *
 * - `cf-aig-cache-ttl: <seconds>` — cache the response for N seconds.
 * - `cf-aig-skip-cache: true` — bypass the cache for this call (non-deterministic
 *   or per-user calls that must never be served stale).
 * - `cf-aig-metadata: <json>` — arbitrary tags (orgId, promptId, traceId) that
 *   surface in the AI Gateway dashboard for per-tenant / per-prompt rollups.
 *
 * @see https://developers.cloudflare.com/ai-gateway/configuration/caching/
 * @see https://developers.cloudflare.com/ai-gateway/configuration/custom-metadata/
 * @packageDocumentation
 */

import { z } from 'zod';
import type { Env } from '../types/env.js';
import { log } from '../lib/log.js';

const gatewayLog = log.child('ai_gateway');

/** Supported upstream providers routed through the gateway. */
export type GatewayProvider = 'openai' | 'anthropic';

/** Default AI Gateway name when {@link Env.AI_GATEWAY_NAME} is unset. */
export const DEFAULT_GATEWAY_NAME = 'projectsites';

/** Default cache TTL (seconds) applied when a caller does not pass `cacheTtl`. */
export const DEFAULT_CACHE_TTL_SECONDS = 3600;

/** Direct vendor base URLs — the fallback target when the gateway errors. */
const DIRECT_BASE_URLS: Record<GatewayProvider, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
};

/**
 * Zod schema for the per-call gateway options a caller may supply.
 *
 * @remarks
 * Validated at the boundary so a malformed `cacheTtl` (e.g. negative, NaN,
 * absurdly large) can never reach the wire as a bogus `cf-aig-cache-ttl` header.
 * Unknown keys are stripped to keep the metadata surface tight.
 */
export const GatewayCallOptionsSchema = z
  .object({
    /**
     * Cache TTL in seconds for `cf-aig-cache-ttl`. `0` disables caching for the
     * call without skipping a cache READ; prefer `skipCache` to bypass entirely.
     * Capped at 31 days (Cloudflare's documented max).
     */
    cacheTtl: z.number().int().min(0).max(2_678_400).optional(),
    /** When `true`, send `cf-aig-skip-cache: true` so the call bypasses the cache. */
    skipCache: z.boolean().optional(),
    /**
     * Arbitrary metadata tags surfaced in the AI Gateway dashboard. String /
     * number / boolean values only (Cloudflare flattens richer shapes).
     */
    metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

/** Inferred per-call gateway options. @see {@link GatewayCallOptionsSchema} */
export type GatewayCallOptions = z.infer<typeof GatewayCallOptionsSchema>;

/**
 * Whether AI Gateway routing is active for this environment.
 *
 * @remarks
 * Gateway is the DEFAULT path: it is active whenever `CF_ACCOUNT_ID` is present
 * AND `AI_GATEWAY_ENABLED` is not explicitly the string `"false"`. This inverts
 * the legacy opt-in (`=== "true"`) so caching is on by default; set
 * `AI_GATEWAY_ENABLED = "false"` to bypass during incident response. When no
 * account id is configured, routing is inactive and callers fall back to the
 * direct vendor URL — generation never breaks.
 *
 * @param env - Worker environment bindings.
 * @returns `true` when calls should route through the gateway.
 *
 * @example
 * ```ts
 * if (isGatewayActive(env)) { ... }
 * ```
 */
export function isGatewayActive(env: Env): boolean {
  return !!env.CF_ACCOUNT_ID && env.AI_GATEWAY_ENABLED !== 'false';
}

/**
 * Resolve the configured gateway name, falling back to {@link DEFAULT_GATEWAY_NAME}.
 *
 * @param env - Worker environment bindings.
 * @returns The AI Gateway name segment for the URL.
 */
export function gatewayName(env: Env): string {
  const name = env.AI_GATEWAY_NAME?.trim();
  return name && name.length > 0 ? name : DEFAULT_GATEWAY_NAME;
}

/**
 * Build the base URL for a provider — the gateway URL when active, else the
 * direct vendor base.
 *
 * @param env - Worker environment bindings.
 * @param provider - Upstream provider.
 * @returns Base URL WITHOUT a trailing slash and WITHOUT the vendor path suffix.
 *
 * @example
 * ```ts
 * gatewayBaseUrl(env, 'openai');
 * // → 'https://gateway.ai.cloudflare.com/v1/<acct>/projectsites/openai'  (active)
 * // → 'https://api.openai.com'                                          (inactive)
 * ```
 */
export function gatewayBaseUrl(env: Env, provider: GatewayProvider): string {
  if (isGatewayActive(env)) {
    return `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${gatewayName(env)}/${provider}`;
  }
  return DIRECT_BASE_URLS[provider];
}

/**
 * Resolve the full URL for a provider call.
 *
 * @param env - Worker environment bindings.
 * @param provider - Upstream provider.
 * @param pathSuffix - Vendor path, e.g. `/v1/chat/completions` or `/v1/messages`.
 * @returns The full request URL (gateway or direct).
 */
export function gatewayUrl(env: Env, provider: GatewayProvider, pathSuffix: string): string {
  return `${gatewayBaseUrl(env, provider)}${pathSuffix}`;
}

/**
 * Merge AI Gateway cache + metadata headers onto a base header set.
 *
 * @remarks
 * Headers are ONLY added when the gateway is active — sending `cf-aig-*` headers
 * to a direct vendor URL is harmless (vendors ignore unknown headers) but we
 * keep the wire clean. `cacheTtl` defaults to {@link DEFAULT_CACHE_TTL_SECONDS}
 * when neither `cacheTtl` nor `skipCache` is supplied, so caching is on by
 * default. `skipCache` wins over `cacheTtl` when both are present.
 *
 * @param env - Worker environment bindings.
 * @param baseHeaders - The vendor auth + content-type headers.
 * @param options - Validated per-call gateway options.
 * @returns A new `Headers` object with `cf-aig-*` entries applied when active.
 */
export function buildGatewayHeaders(
  env: Env,
  baseHeaders: Record<string, string>,
  options: GatewayCallOptions = {},
): Headers {
  const headers = new Headers(baseHeaders);
  if (!isGatewayActive(env)) return headers;

  if (options.skipCache) {
    headers.set('cf-aig-skip-cache', 'true');
  } else {
    const ttl = options.cacheTtl ?? DEFAULT_CACHE_TTL_SECONDS;
    headers.set('cf-aig-cache-ttl', String(ttl));
  }

  if (options.metadata && Object.keys(options.metadata).length > 0) {
    headers.set('cf-aig-metadata', JSON.stringify(options.metadata));
  }

  return headers;
}

/** Result of a gateway-routed fetch — carries whether the gateway served it. */
export interface GatewayFetchResult {
  /** The (already-awaited) `Response`. */
  response: Response;
  /** `true` when the successful response came through the gateway, not the direct fallback. */
  gatewayUsed: boolean;
}

/**
 * Fetch a provider endpoint through the AI Gateway with cache headers + a
 * direct-vendor fallback on gateway 5xx.
 *
 * @remarks
 * Behavior:
 * 1. Validate `options` via {@link GatewayCallOptionsSchema}.
 * 2. Inject `cf-aig-*` cache + metadata headers (when the gateway is active).
 * 3. Fetch the gateway URL.
 * 4. On a 5xx from the gateway (its own error, not a vendor 4xx passed through),
 *    retry ONCE against the direct vendor URL with `X-PS-Gateway-Fallback: true`
 *    for log filtering, stripping the `cf-aig-*` headers.
 *
 * The vendor auth headers in `init.headers` are reused for the fallback — they
 * are valid against the direct URL because the gateway proxies them verbatim.
 *
 * @param env - Worker environment bindings.
 * @param provider - Upstream provider.
 * @param pathSuffix - Vendor path, e.g. `/v1/chat/completions`.
 * @param init - The vendor fetch init (method, headers, body, signal).
 * @param options - Per-call cache + metadata options.
 * @returns The response + whether the gateway served it.
 *
 * @throws ZodError when `options` fails validation.
 *
 * @example
 * ```ts
 * const { response, gatewayUsed } = await gatewayFetch(env, 'openai', '/v1/chat/completions', {
 *   method: 'POST',
 *   headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
 *   body: JSON.stringify(body),
 * }, { cacheTtl: 3600, metadata: { promptId: 'research_brand' } });
 * ```
 */
export async function gatewayFetch(
  env: Env,
  provider: GatewayProvider,
  pathSuffix: string,
  init: RequestInit,
  options: GatewayCallOptions = {},
): Promise<GatewayFetchResult> {
  const opts = GatewayCallOptionsSchema.parse(options);
  const active = isGatewayActive(env);

  const baseHeaders = headersToRecord(init.headers);
  const mergedHeaders = buildGatewayHeaders(env, baseHeaders, opts);

  const primaryUrl = gatewayUrl(env, provider, pathSuffix);
  const response = await fetch(primaryUrl, { ...init, headers: mergedHeaders });

  // Only fall back when the gateway ITSELF 5xx'd. A 4xx is a real vendor error
  // (bad key, malformed body) that the direct URL would also reject — surface it.
  if (active && response.status >= 500 && response.status < 600) {
    gatewayLog.warn('gateway_5xx_fallback', { provider, status: response.status });
    const directUrl = `${DIRECT_BASE_URLS[provider]}${pathSuffix}`;
    const fallbackHeaders = new Headers(baseHeaders);
    fallbackHeaders.set('X-PS-Gateway-Fallback', 'true');
    const fallbackRes = await fetch(directUrl, { ...init, headers: fallbackHeaders });
    return { response: fallbackRes, gatewayUsed: false };
  }

  return { response, gatewayUsed: active };
}

/**
 * Normalize a `HeadersInit` (Headers | Record | tuple array) into a plain record.
 *
 * @param headers - The init headers in any of the three `HeadersInit` shapes.
 * @returns A plain `Record<string,string>` (empty when `headers` is undefined).
 */
function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  const record: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      record[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) record[key] = value;
  } else {
    Object.assign(record, headers);
  }
  return record;
}

/**
 * Build the `cf-aig-metadata` tag object from a trace context.
 *
 * @remarks
 * Convenience for call sites that already carry `{ orgId, userId, traceId,
 * promptId }`. Drops `undefined` values so the metadata header stays compact.
 *
 * @param ctx - Optional trace fields.
 * @returns A flat metadata record suitable for {@link GatewayCallOptions.metadata}.
 *
 * @example
 * ```ts
 * gatewayMetadata({ orgId: 'o_1', promptId: 'research_brand' });
 * // → { orgId: 'o_1', promptId: 'research_brand' }
 * ```
 */
export function gatewayMetadata(ctx?: {
  orgId?: string;
  userId?: string;
  traceId?: string;
  promptId?: string;
}): Record<string, string> {
  const meta: Record<string, string> = {};
  if (!ctx) return meta;
  if (ctx.orgId) meta.orgId = ctx.orgId;
  if (ctx.userId) meta.userId = ctx.userId;
  if (ctx.traceId) meta.traceId = ctx.traceId;
  if (ctx.promptId) meta.promptId = ctx.promptId;
  return meta;
}
